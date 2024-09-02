# transfer-hook-counter

This program is created to test TransferHook extension.

This program requires 2 additional accounts:
- `counter_account`
- `account_order_verifier`

## counter_account
This account has a u32 field that counts the number of times the token has been transferred.
Since it is incremented by +1 for each transfer, it is possible to verify that the TransferHook has been properly processed by checking the counter value.

## account_order_verifier
This account is read-only and the account itself is empty.

However, since the address of this account is a PDA derived from seeds containing the four addresses (source, mint, destination, and owner), it can be used to verify that source, mint, destination, and owner are handled correctly. The PDA can be used to verify that source, mint, destination, and owner are being handled correctly.
(For example, if source and destination are interchanged, a PDA mismatch can be detected.)