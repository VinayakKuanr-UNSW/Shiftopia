/**
 * The broadcast-attachments bucket, over the Storage API.
 *
 * The bucket is PUBLIC (anyone with a file's URL can read it), so who may put
 * files in it matters: until 2026-10-13 any signed-in user could upload any
 * file (free public hosting) and delete anyone's attachment. Upload and delete
 * now mirror public.broadcast_attachments' own rules — broadcast system
 * managers (zeta), or the broadcast's group admins / broadcasters — and an
 * uploader may delete their own file.
 */

import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { personaToken, stack, type Persona } from '../support/clients';

const BUCKET = 'broadcast-attachments';
// 1×1 transparent PNG — the bucket only accepts documents and images.
const PNG = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64');

function headers(p: Persona, extra: Record<string, string> = {}): Record<string, string> {
    return { apikey: stack().anonKey, Authorization: `Bearer ${personaToken(p)}`, ...extra };
}

async function upload(p: Persona, path: string): Promise<Response> {
    return fetch(`${stack().apiUrl}/storage/v1/object/${BUCKET}/${path}`, {
        method: 'POST', headers: headers(p, { 'Content-Type': 'image/png' }), body: PNG,
    });
}

/** Returns how many objects the Storage API reports as removed. */
async function remove(p: Persona, path: string): Promise<number> {
    const res = await fetch(`${stack().apiUrl}/storage/v1/object/${BUCKET}`, {
        method: 'DELETE', headers: headers(p, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ prefixes: [path] }),
    });
    const body = await res.json().catch(() => null);
    return res.ok && Array.isArray(body) ? body.length : 0;
}

async function exists(path: string): Promise<boolean> {
    const res = await fetch(`${stack().apiUrl}/storage/v1/object/public/${BUCKET}/${path}`);
    await res.arrayBuffer();
    return res.ok;
}

describe('broadcast-attachments bucket', () => {
    it('refuses an upload from someone who cannot post to any broadcast', async () => {
        const path = `${randomUUID()}/${Date.now()}.png`;
        const res = await upload('X', path);
        expect(res.ok, `employee upload answered ${res.status}`).toBe(false);
        expect(await exists(path)).toBe(false);
    });

    it('lets a broadcast system manager upload, refuses an employee\'s delete, and lets the manager delete', async () => {
        const path = `${randomUUID()}/${Date.now()}.png`;
        const up = await upload('Z', path);
        expect(up.ok, `system-manager upload answered ${up.status}: ${await up.clone().text()}`).toBe(true);
        expect(await exists(path)).toBe(true);

        expect(await remove('X', path)).toBe(0);
        expect(await exists(path), 'an employee must not be able to delete someone else\'s attachment').toBe(true);

        expect(await remove('Z', path)).toBe(1);
        expect(await exists(path)).toBe(false);
    });
});
