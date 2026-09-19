// packages/burner-wallet/src/derivation.ts

import {toHex} from 'viem';
import {mnemonicToAccount} from 'viem/accounts';
import type {Hex} from './types.js';

/**
 * THE PATH, AND WHY IT IS THIS ONE.
 *
 * `m/44'/60'/0'/0/{index}`: the index moves BIP-44's ADDRESS level, with the
 * account level pinned at 0. That is what `anvil`, `hardhat node`, MetaMask and
 * every "accounts from a mnemonic" list a developer has ever seen does, and
 * BIP-44 agrees: the account level separates identities that should not be
 * linked, the address level enumerates addresses within one identity. Ten
 * accounts of one burner are the second thing, not the first.
 *
 * IT USED TO BE `m/44'/60'/{index}'/0/0`, inherited from
 * `eip-1193-accounts-wrapper`, which passes `accountIndex` to viem. That was
 * wrong in the way that is hardest to catch: index 0 is IDENTICAL under both
 * (`0xf39F...2266` for the standard test mnemonic), so the wallet looked exactly
 * like the node it was pointed at, right up until someone used a second account
 * and funded an address this wallet would never report.
 *
 * Derivation therefore lives HERE rather than being delegated, because the path
 * is a promise this package makes to whoever funds these accounts: hand the
 * mnemonic to any other tool and get the same list back.
 */
export const ACCOUNT_DERIVATION_PATH = "m/44'/60'/0'/0/{index}" as const;

/**
 * Derive `count` private keys from `mnemonic`, in path order.
 *
 * Throws on an invalid mnemonic, which is the only validation this package
 * needs: callers use a successful return as the signal that a mnemonic is
 * usable, so build the accounts BEFORE committing a new mnemonic to state.
 */
export function derivePrivateKeys(mnemonic: string, count: number): Hex[] {
	const privateKeys: Hex[] = [];
	for (let addressIndex = 0; addressIndex < count; addressIndex++) {
		const hdKey = mnemonicToAccount(mnemonic, {addressIndex}).getHdKey();
		if (!hdKey.privateKey) {
			// Not reachable for a mnemonic-derived key; a public-only HD node
			// cannot sign, and silently dropping it would give a wallet with
			// fewer accounts than asked for.
			throw new Error(
				`Failed to derive a private key at ${ACCOUNT_DERIVATION_PATH.replace('{index}', String(addressIndex))}`,
			);
		}
		privateKeys.push(toHex(hdKey.privateKey));
	}
	return privateKeys;
}
