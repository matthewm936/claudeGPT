import { state } from './state.js';
import { handleMessage } from './router.js';

export function connect() {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  state.ws = new WebSocket(`${proto}://${location.host}`);

  state.ws.onopen = () => send({ type: 'list_profiles' });

  state.ws.onmessage = (e) => {
    handleMessage(JSON.parse(e.data));
  };

  state.ws.onclose = () => setTimeout(connect, 2000);
}

export function send(data) {
  if (state.ws?.readyState === 1) state.ws.send(JSON.stringify(data));
}
