import {
  Cl,
  createStacksPrivateKey,
  cvToValue,
  signMessageHashRsv,
} from "@stacks/transactions";
import { describe, expect, it, beforeEach } from "vitest";

// Vitest/Clarinet globals declaration
declare const simnet: any;
declare const accounts: any;

const address1 = accounts.get("wallet_1");
const address2 = accounts.get("wallet_2");
const address3 = accounts.get("wallet_3");
const deployerAddress = accounts.get("deployer");

describe("Token Streaming Contract Tests", () => {
  beforeEach(() => {
    // No action needed here, as streams are created inside individual tests.
  });

  it("ensures contract is initialized properly and stream can be created", () => {
    const sender = address1;
    const recipient = address2;
    const initialBalance = 100;
    const paymentPerBlock = 1;
    const startBlock = 10;
    const stopBlock = 50;

    const { result } = simnet.callPublicFn(
      "stream",
      "stream-to",
      [
        Cl.principal(recipient),
        Cl.uint(initialBalance),
        Cl.tuple({
          "start-block": Cl.uint(startBlock),
          "stop-block": Cl.uint(stopBlock),
        }),
        Cl.uint(paymentPerBlock),
      ],
      sender
    );

    expect(result).toBeOk(Cl.uint(0));
    expect(simnet.getDataVar("stream", "latest-stream-id")).toBeUint(1);

    const { result: streamResult } = simnet.callReadOnlyFn(
      "stream",
      "get-stream",
      [Cl.uint(0)],
      sender
    );

    expect(streamResult).toBeSome();
    const streamData = streamResult.value.data;
    expect(streamData.sender).toBePrincipal(sender);
    expect(streamData.recipient).toBePrincipal(recipient);
    expect(streamData.balance).toBeUint(initialBalance);
    expect(streamData["withdrawn-balance"]).toBeUint(0);
    expect(streamData["payment-per-block"]).toBeUint(paymentPerBlock);
  });

  it("ensures stream can be refueled by sender", () => {
    const sender = address1;
    const recipient = address2;
    const initialBalance = 100;
    const refuelAmount = 50;

    simnet.callPublicFn(
      "stream",
      "stream-to",
      [
        Cl.principal(recipient),
        Cl.uint(initialBalance),
        Cl.tuple({
          "start-block": Cl.uint(10),
          "stop-block": Cl.uint(50),
        }),
        Cl.uint(1),
      ],
      sender
    );

    const { result } = simnet.callPublicFn(
      "stream",
      "refuel",
      [Cl.uint(0), Cl.uint(refuelAmount)],
      sender
    );

    expect(result).toBeOk(Cl.uint(refuelAmount));

    const { result: streamResult } = simnet.callReadOnlyFn(
      "stream",
      "get-stream",
      [Cl.uint(0)],
      sender
    );

    const streamData = streamResult.value.data;
    expect(streamData.balance).toBeUint(initialBalance + refuelAmount);
  });

  it("ensures stream cannot be refueled by non-sender", () => {
    const sender = address1;
    const recipient = address2;
    const nonSender = address3;

    simnet.callPublicFn(
      "stream",
      "stream-to",
      [
        Cl.principal(recipient),
        Cl.uint(100),
        Cl.tuple({
          "start-block": Cl.uint(10),
          "stop-block": Cl.uint(50),
        }),
        Cl.uint(1),
      ],
      sender
    );

    const { result } = simnet.callPublicFn(
      "stream",
      "refuel",
      [Cl.uint(0), Cl.uint(50)],
      nonSender
    );

    expect(result).toBeErr(Cl.uint(0));
  });

  it("ensures recipient can withdraw tokens over time", () => {
    const sender = address1;
    const recipient = address2;
    const initialBalance = 100;
    const paymentPerBlock = 2;
    const startBlock = simnet.burnBlockHeight + 1;
    const stopBlock = startBlock + 50;

    simnet.callPublicFn(
      "stream",
      "stream-to",
      [
        Cl.principal(recipient),
        Cl.uint(initialBalance),
        Cl.tuple({
          "start-block": Cl.uint(startBlock),
          "stop-block": Cl.uint(stopBlock),
        }),
        Cl.uint(paymentPerBlock),
      ],
      sender
    );

    simnet.mineEmptyBlocks(3);

    const { result: balanceResult } = simnet.callReadOnlyFn(
      "stream",
      "balance-of",
      [Cl.uint(0), Cl.principal(recipient)],
      sender
    );

    const availableBalance = balanceResult.value;
    
    const withdrawal = simnet.callPublicFn(
      "stream",
      "withdraw",
      [Cl.uint(0)],
      recipient
    );

    expect(withdrawal.result).toBeOk(availableBalance);
    
    const transferEvent = withdrawal.events.find(e => e.event === "stx_transfer_event");
    expect(transferEvent).toBeDefined();
    expect(transferEvent.data.recipient).toBe(recipient);
    expect(transferEvent.data.amount).toBe(availableBalance.toString());
  });

  it("ensures non-recipient cannot withdraw tokens from stream", () => {
    const sender = address1;
    const recipient = address2;
    const nonRecipient = address3;

    simnet.callPublicFn(
      "stream",
      "stream-to",
      [
        Cl.principal(recipient),
        Cl.uint(100),
        Cl.tuple({
          "start-block": Cl.uint(simnet.burnBlockHeight),
          "stop-block": Cl.uint(simnet.burnBlockHeight + 50),
        }),
        Cl.uint(1),
      ],
      sender
    );

    simnet.mineEmptyBlocks(5);

    const { result } = simnet.callPublicFn(
      "stream",
      "withdraw",
      [Cl.uint(0)],
      nonRecipient
    );

    expect(result).toBeErr(Cl.uint(0));
  });

  it("ensures sender can refund excess tokens after stream ends", () => {
    const sender = address1;
    const recipient = address2;
    const initialBalance = 100;
    const paymentPerBlock = 1;
    const startBlock = simnet.burnBlockHeight + 1;
    const stopBlock = startBlock + 10;

    simnet.callPublicFn(
      "stream",
      "stream-to",
      [
        Cl.principal(recipient),
        Cl.uint(initialBalance),
        Cl.tuple({
          "start-block": Cl.uint(startBlock),
          "stop-block": Cl.uint(stopBlock),
        }),
        Cl.uint(paymentPerBlock),
      ],
      sender
    );

    simnet.mineEmptyBlocks(stopBlock - startBlock + 2);

    const { result: senderBalanceResult } = simnet.callReadOnlyFn(
      "stream",
      "balance-of",
      [Cl.uint(0), Cl.principal(sender)],
      sender
    );

    const refundableAmount = senderBalanceResult.value;

    const refund = simnet.callPublicFn(
      "stream",
      "refund",
      [Cl.uint(0)],
      sender
    );

    expect(refund.result).toBeOk(refundableAmount);
    
    const transferEvent = refund.events.find(e => e.event === "stx_transfer_event");
    expect(transferEvent).toBeDefined();
    expect(transferEvent.data.recipient).toBe(sender);
    expect(transferEvent.data.amount).toBe(refundableAmount.toString());
  });
  
  it("ensures refund fails if stream is still active", () => {
    const sender = address1;
    const recipient = address2;

    simnet.callPublicFn(
      "stream",
      "stream-to",
      [
        Cl.principal(recipient),
        Cl.uint(100),
        Cl.tuple({
          "start-block": Cl.uint(simnet.burnBlockHeight),
          "stop-block": Cl.uint(simnet.burnBlockHeight + 1000),
        }),
        Cl.uint(1),
      ],
      sender
    );

    const { result } = simnet.callPublicFn(
      "stream",
      "refund",
      [Cl.uint(0)],
      sender
    );

    expect(result).toBeErr(Cl.uint(2));
  });

  it("ensures hash-stream function returns consistent hashes", () => {
    const sender = address1;
    const recipient = address2;

    simnet.callPublicFn(
      "stream",
      "stream-to",
      [
        Cl.principal(recipient),
        Cl.uint(100),
        Cl.tuple({
          "start-block": Cl.uint(10),
          "stop-block": Cl.uint(50),
        }),
        Cl.uint(1),
      ],
      sender
    );

    const { result: hash1 } = simnet.callReadOnlyFn(
      "stream",
      "hash-stream",
      [
        Cl.uint(0),
        Cl.uint(2),
        Cl.tuple({
          "start-block": Cl.uint(20),
          "stop-block": Cl.uint(60),
        }),
      ],
      sender
    );

    const { result: hash2 } = simnet.callReadOnlyFn(
      "stream",
      "hash-stream",
      [
        Cl.uint(0),
        Cl.uint(2),
        Cl.tuple({
          "start-block": Cl.uint(20),
          "stop-block": Cl.uint(60),
        }),
      ],
      sender
    );

    expect(hash1.expectOk()).toEqual(hash2.expectOk());
    
    const { result: hash3 } = simnet.callReadOnlyFn(
      "stream",
      "hash-stream",
      [
        Cl.uint(0),
        Cl.uint(3),
        Cl.tuple({
          "start-block": Cl.uint(20),
          "stop-block": Cl.uint(60),
        }),
      ],
      sender
    );

    expect(hash1.expectOk()).not.toEqual(hash3.expectOk());
  });
  
  it("ensures calculate-block-delta works correctly", () => {
    const currentBlock = simnet.burnBlockHeight;
    
    const { result: future } = simnet.callReadOnlyFn(
      "stream",
      "calculate-block-delta",
      [
        Cl.tuple({
          "start-block": Cl.uint(currentBlock + 10),
          "stop-block": Cl.uint(currentBlock + 20),
        }),
      ],
      deployerAddress
    );
    expect(future).toBeUint(0);

    const { result: active } = simnet.callReadOnlyFn(
      "stream",
      "calculate-block-delta",
      [
        Cl.tuple({
          "start-block": Cl.uint(currentBlock - 5),
          "stop-block": Cl.uint(currentBlock + 10),
        }),
      ],
      deployerAddress
    );
    expect(active).toBeUint(6); 

    const { result: ended } = simnet.callReadOnlyFn(
      "stream",
      "calculate-block-delta",
      [
        Cl.tuple({
          "start-block": Cl.uint(currentBlock - 20),
          "stop-block": Cl.uint(currentBlock - 5),
        }),
      ],
      deployerAddress
    );
    expect(ended).toBeUint(16);
  });

  it("ensures balance-of calculations are correct", () => {
    const sender = address1;
    const recipient = address2;
    const initialBalance = 100;
    const paymentPerBlock = 2;
    const startBlock = simnet.burnBlockHeight;
    const stopBlock = startBlock + 25;

    simnet.callPublicFn(
      "stream",
      "stream-to",
      [
        Cl.principal(recipient),
        Cl.uint(initialBalance),
        Cl.tuple({
          "start-block": Cl.uint(startBlock),
          "stop-block": Cl.uint(stopBlock),
        }),
        Cl.uint(paymentPerBlock),
      ],
      sender
    );

    simnet.mineEmptyBlocks(10);

    const { result: recipientBalance } = simnet.callReadOnlyFn(
      "stream",
      "balance-of",
      [Cl.uint(0), Cl.principal(recipient)],
      sender
    );

    expect(recipientBalance).toBeUint(22);

    const { result: senderBalance } = simnet.callReadOnlyFn(
      "stream",
      "balance-of",
      [Cl.uint(0), Cl.principal(sender)],
      sender
    );

    expect(senderBalance).toBeUint(78);

    const { result: nonParticipantBalance } = simnet.callReadOnlyFn(
      "stream",
      "balance-of",
      [Cl.uint(0), Cl.principal(address3)],
      sender
    );

    expect(nonParticipantBalance).toBeUint(0);
  });

  it("ensures get-latest-stream-id works correctly", () => {
    const { result: initial } = simnet.callReadOnlyFn(
      "stream",
      "get-latest-stream-id",
      [],
      deployerAddress
    );

    const initialId = initial.value;

    simnet.callPublicFn(
      "stream",
      "stream-to",
      [
        Cl.principal(address2),
        Cl.uint(100),
        Cl.tuple({
          "start-block": Cl.uint(10),
          "stop-block": Cl.uint(50),
        }),
        Cl.uint(1),
      ],
      address1
    );

    const { result: afterCreation } = simnet.callReadOnlyFn(
      "stream",
      "get-latest-stream-id",
      [],
      deployerAddress
    );

    expect(afterCreation).toBeUint(initialId + 1);
  });
});
