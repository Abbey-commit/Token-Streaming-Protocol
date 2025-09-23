import { describe, it, expect } from "vitest";
import { Chain, Tx, Account } from "@hirosystems/clarinet-sdk";

describe("Stream contract", () => {
  it("stream-to > creates a new stream", () => {
    let chain = new Chain();
    let accounts = chain.getAccounts();
    let deployer = accounts.get("deployer")!;
    let wallet1 = accounts.get("wallet_1")!;

    let block = chain.mineBlock([
      Tx.contractCall(
        "stream",
        "stream-to",
        [wallet1.address, "u1000", "{start-block: u10, stop-block: u100}", "u10"],
        deployer.address
      ),
    ]);

    expect(block.receipts[0].result).toBeOk();
  });

  it("withdraw > allows recipient to withdraw funds", () => {
    let chain = new Chain();
    let accounts = chain.getAccounts();
    let deployer = accounts.get("deployer")!;
    let wallet1 = accounts.get("wallet_1")!;

    chain.mineBlock([
      Tx.contractCall(
        "stream",
        "stream-to",
        [wallet1.address, "u1000", "{start-block: u10, stop-block: u100}", "u10"],
        deployer.address
      ),
    ]);

    let block = chain.mineBlock([
      Tx.contractCall(
        "stream",
        "withdraw",
        ["u1", "u10"],
        wallet1.address
      ),
    ]);

    expect(block.receipts[0].result).toBeOk();
  });

  it("cancel > cancels a stream", () => {
    let chain = new Chain();
    let accounts = chain.getAccounts();
    let deployer = accounts.get("deployer")!;
    let wallet1 = accounts.get("wallet_1")!;

    chain.mineBlock([
      Tx.contractCall(
        "stream",
        "stream-to",
        [wallet1.address, "u1000", "{start-block: u10, stop-block: u100}", "u10"],
        deployer.address
      ),
    ]);

    let block = chain.mineBlock([
      Tx.contractCall(
        "stream",
        "cancel",
        ["u1"],
        deployer.address
      ),
    ]);

    expect(block.receipts[0].result).toBeOk();
  });

  it("balance-of > returns correct stream balance for recipient", () => {
    let chain = new Chain();
    let accounts = chain.getAccounts();
    let deployer = accounts.get("deployer")!;
    let wallet1 = accounts.get("wallet_1")!;

    chain.mineBlock([
      Tx.contractCall(
        "stream",
        "stream-to",
        [wallet1.address, "u1000", "{start-block: u10, stop-block: u100}", "u10"],
        deployer.address
      ),
    ]);

    let block = chain.mineBlock([
      Tx.contractCall(
        "stream",
        "balance-of",
        ["u1", wallet1.address],
        wallet1.address
      ),
    ]);

    expect(block.receipts[0].result).toBeOk();
  });

  it("fails if duration is zero", () => {
    let chain = new Chain();
    let accounts = chain.getAccounts();
    let deployer = accounts.get("deployer")!;
    let wallet1 = accounts.get("wallet_1")!;

    let block = chain.mineBlock([
      Tx.contractCall(
        "stream",
        "stream-to",
        [wallet1.address, "u1000", "{start-block: u10, stop-block: u10}", "u10"],
        deployer.address
      ),
    ]);

    expect(block.receipts[0].result).toBeErr();
  });

  it("fails if stop block < start block", () => {
    let chain = new Chain();
    let accounts = chain.getAccounts();
    let deployer = accounts.get("deployer")!;
    let wallet1 = accounts.get("wallet_1")!;

    let block = chain.mineBlock([
      Tx.contractCall(
        "stream",
        "stream-to",
        [wallet1.address, "u1000", "{start-block: u100, stop-block: u10}", "u10"],
        deployer.address
      ),
    ]);

    expect(block.receipts[0].result).toBeErr();
  });

  it("fails if deposit < duration", () => {
    let chain = new Chain();
    let accounts = chain.getAccounts();
    let deployer = accounts.get("deployer")!;
    let wallet1 = accounts.get("wallet_1")!;

    let block = chain.mineBlock([
      Tx.contractCall(
        "stream",
        "stream-to",
        [wallet1.address, "u5", "{start-block: u10, stop-block: u100}", "u200"],
        deployer.address
      ),
    ]);

    expect(block.receipts[0].result).toBeErr();
  });

  it("fails if stream id does not exist", () => {
    let chain = new Chain();
    let accounts = chain.getAccounts();
    let wallet1 = accounts.get("wallet_1")!;

    let block = chain.mineBlock([
      Tx.contractCall(
        "stream",
        "withdraw",
        ["u999", "u10"],
        wallet1.address
      ),
    ]);

    expect(block.receipts[0].result).toBeErr();
  });
});
