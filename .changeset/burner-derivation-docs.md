---
'@etherkit/burner-wallet': patch
---

Document the 0.1.0 derivation path change for people carrying an old burner. The README now has an "Upgrading from 0.0.x" section: the mnemonic in `localStorage` is kept and account 0 keeps its address, but accounts 1 and above change address (from `m/44'/60'/{index}'/0/0` to `m/44'/60'/0'/0/{index}`), so funds on them look lost. It says what to do: move them to account 0 before upgrading, or derive the old accounts afterwards from the same mnemonic with viem's `mnemonicToAccount(mnemonic, {accountIndex})` and move them then. Documentation only, no code change.
