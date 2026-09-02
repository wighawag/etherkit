import {Instance, Server} from 'prool';
import {RPC_PORT} from './url.js';

export const anvilServer = Server.create({
	instance: Instance.anvil(),
	port: RPC_PORT,
});
