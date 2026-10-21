/**
 * Runs once before the integration suite: find the local stack, refuse
 * anything that is not local, load the persona fixtures, and hand the tests
 * the stack details and persona ids.
 */

import type { TestProject } from 'vitest/node';
import { psql, resetFixtures, resolveStackEnv, type StackEnv } from '../support/stack';

declare module 'vitest' {
    export interface ProvidedContext {
        stack: StackEnv;
        personas: Record<string, string>;
    }
}

export default async function setup(project: TestProject): Promise<void> {
    const stack = resolveStackEnv();

    const res = await fetch(`${stack.apiUrl}/rest/v1/`, { headers: { apikey: stack.anonKey } });
    if (!res.ok) throw new Error(`Local API at ${stack.apiUrl} answered ${res.status}; is the stack healthy?`);

    resetFixtures(stack.dbContainer);
    const personas = Object.fromEntries(psql(stack.dbContainer, 'SELECT n, id FROM public._t_persona ORDER BY n'));

    project.provide('stack', stack);
    project.provide('personas', personas);
}
