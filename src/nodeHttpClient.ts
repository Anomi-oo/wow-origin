import { Agent, setGlobalDispatcher } from 'undici';

// YouTube watch responses exceed Node's default 16 KiB response-header limit.
// Only Node entry points load this; Workers keep their native fetch transport.
setGlobalDispatcher(new Agent({ maxHeaderSize: 64 * 1024 }));
