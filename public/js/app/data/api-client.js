/**
 * Transport: one place that knows how this app talks HTTP.
 *
 * Nothing above this layer touches `fetch`, so JSON encoding, error shaping and
 * the "session expired" redirect exist exactly once. `fetchImpl` and
 * `onUnauthorized` are injected, which also makes it testable outside a browser.
 */
export class ApiClient {
  constructor({ baseUrl = '', fetchImpl = (...args) => fetch(...args), onUnauthorized = () => {} } = {}) {
    this.baseUrl = baseUrl;
    this.fetchImpl = fetchImpl;
    this.onUnauthorized = onUnauthorized;
  }

  /**
   * @param {string} path
   * @param {{ method?: string, body?: unknown, raw?: boolean, query?: string }} [options]
   */
  async request(path, options = {}) {
    const init = {
      method: options.method || (options.body !== undefined ? 'POST' : 'GET'),
      credentials: 'same-origin',
      headers: {}
    };
    if (options.body !== undefined) {
      if (options.raw) {
        init.body = options.body;
      } else {
        init.body = JSON.stringify(options.body);
        init.headers['Content-Type'] = 'application/json';
      }
    }

    const url = this.baseUrl + path + (options.query ? `?${options.query}` : '');
    const response = await this.fetchImpl(url, init);
    const isJson = (response.headers.get('content-type') || '').includes('json');
    const payload = isJson ? await response.json() : await response.text();

    if (response.status === 401) {
      this.onUnauthorized();
      throw new Error('Your session has expired. Please sign in again.');
    }
    if (!response.ok) throw new Error((payload && payload.error) || `HTTP ${response.status}`);
    return payload;
  }

  get(path, query) {
    return this.request(path, { query });
  }

  post(path, body) {
    return this.request(path, { method: 'POST', body });
  }

  put(path, body) {
    return this.request(path, { method: 'PUT', body });
  }

  patch(path, body) {
    return this.request(path, { method: 'PATCH', body });
  }

  delete(path) {
    return this.request(path, { method: 'DELETE' });
  }
}
