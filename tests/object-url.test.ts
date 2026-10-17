import { afterEach, describe, expect, it, vi } from 'vitest';
import { acquireObjectUrl } from '../lib/object-url';

afterEach(() => vi.restoreAllMocks());

describe('image object URL ownership', () => {
  it('shares a Blob URL until the last image detaches, without double releasing it', () => {
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:shared-image');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const blob = new Blob(['pixels']);
    const preview = acquireObjectUrl(blob);
    const thumbnail = acquireObjectUrl(blob);
    expect(preview.url).toBe(thumbnail.url);
    expect(create).toHaveBeenCalledTimes(1);
    preview.release();
    preview.release();
    expect(revoke).not.toHaveBeenCalled();
    thumbnail.release();
    thumbnail.release();
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:shared-image');
  });

  it('allocates a fresh URL after an effect cleanup rather than reusing a revoked one', () => {
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValueOnce('blob:first-mount').mockReturnValueOnce('blob:remount');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const blob = new Blob(['pixels']);
    const firstMount = acquireObjectUrl(blob);
    firstMount.release();
    const remount = acquireObjectUrl(blob);
    expect(remount.url).toBe('blob:remount');
    expect(create).toHaveBeenCalledTimes(2);
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:first-mount');
    remount.release();
    expect(revoke.mock.calls).toEqual([['blob:first-mount'], ['blob:remount']]);
  });

  it('replacing one image never invalidates another Blob or an overlapping consumer', () => {
    vi.spyOn(URL, 'createObjectURL').mockReturnValueOnce('blob:original').mockReturnValueOnce('blob:enhanced');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    const original = new Blob(['original']);
    const enhanced = new Blob(['enhanced']);
    const outgoing = acquireObjectUrl(original);
    const compare = acquireObjectUrl(original);
    const incoming = acquireObjectUrl(enhanced);
    outgoing.release();
    incoming.release();
    expect(revoke.mock.calls).toEqual([['blob:enhanced']]);
    compare.release();
    expect(revoke.mock.calls).toEqual([['blob:enhanced'], ['blob:original']]);
  });
});
