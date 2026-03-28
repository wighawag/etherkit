import {BurnerKeyStorage} from './storage.js';
import type {Hex} from './storage.js';

export type BurnerWalletManagerOptions = {
	storage: BurnerKeyStorage;
	onAccountsChanged?: (addresses: Hex[]) => void;
};

const STYLES = `
.bw-manager {
	font-family: monospace;
	font-size: 13px;
	background: #1a1a2e;
	color: #e0e0e0;
	border: 1px solid #333;
	border-radius: 8px;
	padding: 12px;
	max-width: 360px;
}
.bw-manager-title {
	font-size: 14px;
	font-weight: bold;
	color: #ffd700;
	margin-bottom: 8px;
}
.bw-manager-list {
	list-style: none;
	padding: 0;
	margin: 0 0 8px 0;
}
.bw-manager-item {
	display: flex;
	align-items: center;
	justify-content: space-between;
	padding: 6px 8px;
	margin-bottom: 4px;
	background: #2a2a3e;
	border-radius: 4px;
}
.bw-manager-addr {
	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
	flex: 1;
	margin-right: 8px;
}
.bw-manager-btn {
	font-family: monospace;
	font-size: 12px;
	border: 1px solid #555;
	border-radius: 4px;
	padding: 4px 8px;
	cursor: pointer;
	background: #333;
	color: #e0e0e0;
}
.bw-manager-btn:hover {
	background: #444;
}
.bw-manager-btn-remove {
	color: #ff6b6b;
	border-color: #ff6b6b;
}
.bw-manager-btn-remove:hover {
	background: #3a2020;
}
.bw-manager-actions {
	display: flex;
	gap: 8px;
}
.bw-manager-btn-create {
	color: #6bff6b;
	border-color: #6bff6b;
}
.bw-manager-btn-create:hover {
	background: #203a20;
}
.bw-manager-btn-clear {
	color: #ff6b6b;
	border-color: #ff6b6b;
}
.bw-manager-btn-clear:hover {
	background: #3a2020;
}
.bw-manager-empty {
	color: #888;
	font-style: italic;
	margin-bottom: 8px;
}
`;

export function createBurnerWalletManager(
	options: BurnerWalletManagerOptions
): HTMLElement {
	const {storage, onAccountsChanged} = options;

	// Inject styles once
	if (!document.getElementById('bw-manager-styles')) {
		const style = document.createElement('style');
		style.id = 'bw-manager-styles';
		style.textContent = STYLES;
		document.head.appendChild(style);
	}

	const container = document.createElement('div');
	container.className = 'bw-manager';

	function render() {
		const addresses = storage.getAddresses();
		container.innerHTML = '';

		const title = document.createElement('div');
		title.className = 'bw-manager-title';
		title.textContent = 'Burner Wallet';
		container.appendChild(title);

		if (addresses.length === 0) {
			const empty = document.createElement('div');
			empty.className = 'bw-manager-empty';
			empty.textContent = 'No accounts';
			container.appendChild(empty);
		} else {
			const list = document.createElement('ul');
			list.className = 'bw-manager-list';
			for (const addr of addresses) {
				const item = document.createElement('li');
				item.className = 'bw-manager-item';

				const addrSpan = document.createElement('span');
				addrSpan.className = 'bw-manager-addr';
				addrSpan.textContent =
					addr.slice(0, 6) + '...' + addr.slice(-4);
				addrSpan.title = addr;
				item.appendChild(addrSpan);

				const removeBtn = document.createElement('button');
				removeBtn.className = 'bw-manager-btn bw-manager-btn-remove';
				removeBtn.textContent = 'Remove';
				removeBtn.addEventListener('click', () => {
					storage.removeAccount(addr);
					onAccountsChanged?.(storage.getAddresses());
					render();
				});
				item.appendChild(removeBtn);

				list.appendChild(item);
			}
			container.appendChild(list);
		}

		const actions = document.createElement('div');
		actions.className = 'bw-manager-actions';

		const createBtn = document.createElement('button');
		createBtn.className = 'bw-manager-btn bw-manager-btn-create';
		createBtn.textContent = '+ New Account';
		createBtn.addEventListener('click', () => {
			storage.createAccount();
			onAccountsChanged?.(storage.getAddresses());
			render();
		});
		actions.appendChild(createBtn);

		if (addresses.length > 0) {
			const clearBtn = document.createElement('button');
			clearBtn.className = 'bw-manager-btn bw-manager-btn-clear';
			clearBtn.textContent = 'Clear All';
			clearBtn.addEventListener('click', () => {
				storage.clear();
				onAccountsChanged?.(storage.getAddresses());
				render();
			});
			actions.appendChild(clearBtn);
		}

		container.appendChild(actions);
	}

	render();
	return container;
}
