import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const storage = vi.hoisted(() => new Map());

vi.stubGlobal('localStorage', {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
  clear: () => storage.clear(),
});

const jsonResponse = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  statusText: status === 200 ? 'OK' : 'Error',
  text: async () => (body == null ? '' : JSON.stringify(body)),
});

describe('orderMatrices API wrapper', () => {
  let fetchMock;

  beforeEach(() => {
    storage.clear();
    storage.set('userName', 'Test QS');
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('lists matrices for a development', async () => {
    const { listMatricesForDevelopment } = await import('./orderMatrices');
    fetchMock.mockResolvedValue(
      jsonResponse([{ id: 'mx-1', orderKey: 'dev-1::sup-1::0120', developmentId: 'dev-1' }])
    );

    const result = await listMatricesForDevelopment('dev-1');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/developments\/dev-1\/matrices$/)
    );
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('mx-1');
  });

  it('returns an empty list when the server body is not an array', async () => {
    const { listMatricesForDevelopment } = await import('./orderMatrices');
    fetchMock.mockResolvedValue(jsonResponse({ matrices: [] }));

    await expect(listMatricesForDevelopment('dev-1')).resolves.toEqual([]);
  });

  it('gets a matrix by package UUID', async () => {
    const { getMatrixByPackageId } = await import('./orderMatrices');
    fetchMock.mockResolvedValue(jsonResponse({ id: 'mx-1', packageId: 'pkg-uuid' }));

    const result = await getMatrixByPackageId('pkg-uuid');

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/packages\/pkg-uuid\/matrix$/)
    );
    expect(result.packageId).toBe('pkg-uuid');
  });

  it('gets a matrix by orderKey', async () => {
    const { getMatrixByOrderKey } = await import('./orderMatrices');
    const orderKey = 'dev-1::sup-1::0120';
    fetchMock.mockResolvedValue(jsonResponse({ id: 'mx-1', orderKey }));

    const result = await getMatrixByOrderKey(orderKey);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/packages\/by-order-key\/dev-1%3A%3Asup-1%3A%3A0120\/matrix$/)
    );
    expect(result.orderKey).toBe(orderKey);
  });

  it('puts a matrix for a package and includes the session actor', async () => {
    const { putMatrixForPackage } = await import('./orderMatrices');
    fetchMock.mockResolvedValue(jsonResponse({ id: 'mx-1', version: 2 }));

    const result = await putMatrixForPackage('pkg-uuid', { orderKey: 'dev-1::sup-1::0120' });

    expect(result.version).toBe(2);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/api\/packages\/pkg-uuid\/matrix$/),
      expect.objectContaining({
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
      })
    );
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.actor).toBe('Test QS');
    expect(body.orderKey).toBe('dev-1::sup-1::0120');
  });

  it('throws a typed API error for non-OK responses', async () => {
    const { getMatrixByPackageId, OrderMatrixApiError } = await import('./orderMatrices');
    fetchMock.mockResolvedValue(
      jsonResponse({ message: 'Order matrix not found.' }, 404)
    );

    const error = await getMatrixByPackageId('missing').catch((caught) => caught);
    expect(error).toBeInstanceOf(OrderMatrixApiError);
    expect(error.status).toBe(404);
    expect(error.message).toBe('Order matrix not found.');
  });

  it('surfaces a 500 body message', async () => {
    const { listMatricesForDevelopment } = await import('./orderMatrices');
    fetchMock.mockResolvedValue(
      jsonResponse({ message: 'Order matrices unavailable' }, 500)
    );

    await expect(listMatricesForDevelopment('dev-1')).rejects.toMatchObject({
      name: 'OrderMatrixApiError',
      status: 500,
      message: 'Order matrices unavailable',
    });
  });
});
