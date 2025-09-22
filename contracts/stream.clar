;; Token Streaming Protocol - Working Version

;; Error codes
(define-constant ERR_UNAUTHORIZED (err u0))
(define-constant ERR_INVALID_SIGNATURE (err u1))
(define-constant ERR_STREAM_STILL_ACTIVE (err u2))
(define-constant ERR_INVALID_STREAM_ID (err u3))
(define-constant ERR_NO_WITHDRAWABLE_BALANCE (err u4))
(define-constant ERR_NO_REFUNDABLE_BALANCE (err u5))
(define-constant ERR_CONSENSUS_BUFFER_CONVERSION (err u6))
(define-constant ERR_INVALID_AMOUNT (err u7))

;; Data variables
(define-data-var latest-stream-id uint u0)

;; Streams mapping
(define-map streams
    uint ;; stream id
    {
        sender: principal,
        recipient: principal,
        balance: uint,
        withdrawn-balance: uint,
        payment-per-block: uint,
        timeframe: (tuple (start-block uint) (stop-block uint))
    }
)

;; Create a new stream
(define-public (stream-to
    (recipient principal)
    (initial-balance uint)
    (timeframe (tuple (start-block uint) (stop-block uint)))
    (payment-per-block uint)
  ) 
  (let (
    (stream {
        sender: contract-caller,
        recipient: recipient,
        balance: initial-balance,
        withdrawn-balance: u0,
        payment-per-block: payment-per-block,
        timeframe: timeframe
    })
    (current-stream-id (var-get latest-stream-id))
  )
    (asserts! (> initial-balance u0) ERR_INVALID_AMOUNT) ;; ADDED CHECK
    (try! (stx-transfer? initial-balance contract-caller (as-contract tx-sender)))
    (map-set streams current-stream-id stream)
    (var-set latest-stream-id (+ current-stream-id u1))
    (ok current-stream-id)
  )
)

;; Increase the locked STX balance for a stream
(define-public (refuel
    (stream-id uint)
    (amount uint)
  )
  (let (
    (stream (unwrap! (map-get? streams stream-id) ERR_INVALID_STREAM_ID))
  )
    (asserts! (> amount u0) ERR_INVALID_AMOUNT) ;; ADDED CHECK
    (asserts! (is-eq contract-caller (get sender stream)) ERR_UNAUTHORIZED)
    (try! (stx-transfer? amount contract-caller (as-contract tx-sender)))
    (map-set streams stream-id 
      (merge stream {balance: (+ (get balance stream) amount)})
    )
    (ok amount)
  )
)

;; Calculate how many blocks have elapsed for streaming
(define-read-only (calculate-block-delta
    (timeframe (tuple (start-block uint) (stop-block uint)))
  )
  (let (
    (start-block (get start-block timeframe))
    (stop-block (get stop-block timeframe))
    (current-block (+ burn-block-height u1))
    (delta 
      (if (<= current-block start-block)
        u0
        (if (< current-block stop-block)
          (- current-block start-block)
          (- stop-block start-block)
        ) 
      )
    )
  )
    delta
  )
)

;; Check balance for a party involved in a stream
(define-read-only (balance-of
    (stream-id uint)
    (who principal)
  )
  (match (map-get? streams stream-id)
    stream (let (
      (block-delta (calculate-block-delta (get timeframe stream)))
      (recipient-balance (* block-delta (get payment-per-block stream)))
    )
      (if (is-eq who (get recipient stream))
        (if (> recipient-balance (get withdrawn-balance stream))
          (- recipient-balance (get withdrawn-balance stream))
          u0
        )
        (if (is-eq who (get sender stream))
          (if (> (get balance stream) recipient-balance)
            (- (get balance stream) recipient-balance)
            u0
          )
          u0
        )
      )
    )
    u0
  )
)

;; (define-read-only (balance-of (stream-id uint) (who principal) ) (match (map-get? streams stream-id) stream (let ( (block-delta (calculate-block-delta (get timeframe stream))) (recipient-balance (* block-delta (get payment-per-block stream))) ) (if (is-eq who (get recipient stream)) (if (> recipient-balance (get withdrawn-balance stream)) (- recipient-balance (get withdrawn-balance stream)) u0 ) (if (is-eq who (get sender stream)) (if (> (get balance stream) recipient-balance) (- (get balance stream) recipient-balance) u0 ) u0 ) ) ) u0 ) )

;; Withdraw received tokens
(define-public (withdraw
    (stream-id uint)
  )
  (let (
    (stream (unwrap! (map-get? streams stream-id) ERR_INVALID_STREAM_ID))
    (withdrawable-balance (balance-of stream-id contract-caller))
  )
    (asserts! (is-eq contract-caller (get recipient stream)) ERR_UNAUTHORIZED)
    (asserts! (> withdrawable-balance u0) ERR_NO_WITHDRAWABLE_BALANCE)
    
    (map-set streams stream-id
      (merge stream {withdrawn-balance: (+ (get withdrawn-balance stream) withdrawable-balance)})
    )
    
    (try! (as-contract (stx-transfer? withdrawable-balance tx-sender (get recipient stream))))
    (ok withdrawable-balance)
  )
)

;; Withdraw excess locked tokens (sender only, after stream ends)
(define-public (refund
    (stream-id uint)
  )
  (let (
    (stream (unwrap! (map-get? streams stream-id) ERR_INVALID_STREAM_ID))
    (refundable-balance (balance-of stream-id (get sender stream)))
  )
    (asserts! (is-eq contract-caller (get sender stream)) ERR_UNAUTHORIZED)
    (asserts! (< (get stop-block (get timeframe stream)) burn-block-height) ERR_STREAM_STILL_ACTIVE)
    (asserts! (> refundable-balance u0) ERR_NO_REFUNDABLE_BALANCE)
    
    (map-set streams stream-id 
      (merge stream {balance: (- (get balance stream) refundable-balance)})
    )
    
    (try! (as-contract (stx-transfer? refundable-balance tx-sender (get sender stream))))
    (ok refundable-balance)
  )
)

;; Get hash of stream for signature verification
(define-read-only (hash-stream
    (stream-id uint)
    (new-payment-per-block uint)
    (new-timeframe (tuple (start-block uint) (stop-block uint)))
  )
  (match (map-get? streams stream-id)
    stream (match (to-consensus-buff? stream)
      stream-buff (match (to-consensus-buff? new-payment-per-block)
        payment-buff (match (to-consensus-buff? new-timeframe)
          timeframe-buff (let (
            (combined-buff (concat (concat stream-buff payment-buff) timeframe-buff))
          )
            (ok (sha256 combined-buff))
          )
          (err ERR_CONSENSUS_BUFFER_CONVERSION)
        )
        (err ERR_CONSENSUS_BUFFER_CONVERSION)
      )
      (err ERR_CONSENSUS_BUFFER_CONVERSION)
    )
    (err ERR_INVALID_STREAM_ID)
  )
)

;; Verify signature
(define-read-only (validate-signature 
    (message-hash (buff 32)) 
    (signature (buff 65)) 
    (signer principal)
  )
  (is-eq 
    (principal-of? (unwrap! (secp256k1-recover? message-hash signature) false)) 
    (ok signer)
  )
)

;; Update stream configuration
(define-public (update-details
    (stream-id uint)
    (new-payment-per-block uint)
    (new-timeframe (tuple (start-block uint) (stop-block uint)))
    (signer principal)
    (signature (buff 65))
  )
  (let (
    (stream (unwrap! (map-get? streams stream-id) ERR_INVALID_STREAM_ID))
    (message-hash (unwrap! (hash-stream stream-id new-payment-per-block new-timeframe) (err u6)))
  )
    (asserts! (validate-signature message-hash signature signer) ERR_INVALID_SIGNATURE)
    (asserts!
      (or
        (and (is-eq (get sender stream) contract-caller) (is-eq (get recipient stream) signer))
        (and (is-eq (get sender stream) signer) (is-eq (get recipient stream) contract-caller))
      )
      ERR_UNAUTHORIZED
    )
    (map-set streams stream-id 
      (merge stream {
        payment-per-block: new-payment-per-block,
        timeframe: new-timeframe
      })
    )
    (ok true)
  )
)

;; Read-only helper functions
(define-read-only (get-stream (stream-id uint))
  (map-get? streams stream-id)
)

(define-read-only (get-latest-stream-id)
  (var-get latest-stream-id)
)
