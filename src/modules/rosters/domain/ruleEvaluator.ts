/**
 * Demand Engine L3 — Rule DSL parser + evaluator.
 *
 * A small, safe expression language for demand_rules.formula. NO eval/Function.
 *
 * Grammar (precedence low → high):
 *   expr      := ternary
 *   ternary   := logic_or ('?' expr ':' expr)?
 *   logic_or  := logic_and ('||' logic_and)*
 *   logic_and := equality  ('&&' equality)*
 *   equality  := compare   (('==' | '!=') compare)*
 *   compare   := additive  (('<' | '<=' | '>' | '>=') additive)?
 *   additive  := multiplic (('+' | '-') multiplic)*
 *   multiplic := unary     (('*' | '/' | '%') unary)*
 *   unary     := ('-' | '!')? primary
 *   primary   := number | identifier | call | array_access | '(' expr ')'
 *   call      := identifier '(' (expr (',' expr)*)? ')'
 *   array_access := identifier '[' expr ']'
 *
 * Variables: pax, room_count, total_sqm, duration_min, bump_in_min,
 *            bump_out_min, slice_idx, staff_at_levels (array)
 * Functions: ceil, floor, round, min, max, abs, clamp(x, lo, hi)
 * Booleans:  true, false   (return 1/0 in numeric contexts)
 *
 * Determinism: pure function. Same context + expression → same output, always.
 */

import type { DemandRuleRow, RuleEvalContext } from './ruleEngine.types';

// ── Tokenizer ──────────────────────────────────────────────────────────────

type TokenKind =
    | 'NUM' | 'IDENT' | 'LPAREN' | 'RPAREN' | 'LBRACK' | 'RBRACK'
    | 'COMMA' | 'PLUS' | 'MINUS' | 'STAR' | 'SLASH' | 'PERCENT'
    | 'LT' | 'LTE' | 'GT' | 'GTE' | 'EQ' | 'NEQ'
    | 'AND' | 'OR' | 'NOT' | 'QMARK' | 'COLON' | 'EOF';

interface Token {
    kind: TokenKind;
    value: string;
    pos: number;
}

function tokenize(src: string): Token[] {
    const tokens: Token[] = [];
    let i = 0;
    while (i < src.length) {
        const c = src[i];
        if (c === ' ' || c === '\t' || c === '\n' || c === '\r') { i++; continue; }
        const start = i;
        if (c >= '0' && c <= '9' || (c === '.' && src[i + 1] >= '0' && src[i + 1] <= '9')) {
            let j = i;
            while (j < src.length && (src[j] >= '0' && src[j] <= '9' || src[j] === '.')) j++;
            tokens.push({ kind: 'NUM', value: src.slice(i, j), pos: start });
            i = j; continue;
        }
        if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_') {
            let j = i;
            while (j < src.length && (
                (src[j] >= 'a' && src[j] <= 'z') ||
                (src[j] >= 'A' && src[j] <= 'Z') ||
                (src[j] >= '0' && src[j] <= '9') ||
                src[j] === '_'
            )) j++;
            tokens.push({ kind: 'IDENT', value: src.slice(i, j), pos: start });
            i = j; continue;
        }
        // Two-char operators first
        const two = src.slice(i, i + 2);
        if (two === '<=') { tokens.push({ kind: 'LTE', value: two, pos: start }); i += 2; continue; }
        if (two === '>=') { tokens.push({ kind: 'GTE', value: two, pos: start }); i += 2; continue; }
        if (two === '==') { tokens.push({ kind: 'EQ', value: two, pos: start }); i += 2; continue; }
        if (two === '!=') { tokens.push({ kind: 'NEQ', value: two, pos: start }); i += 2; continue; }
        if (two === '&&') { tokens.push({ kind: 'AND', value: two, pos: start }); i += 2; continue; }
        if (two === '||') { tokens.push({ kind: 'OR', value: two, pos: start }); i += 2; continue; }
        switch (c) {
            case '(': tokens.push({ kind: 'LPAREN', value: c, pos: start }); i++; continue;
            case ')': tokens.push({ kind: 'RPAREN', value: c, pos: start }); i++; continue;
            case '[': tokens.push({ kind: 'LBRACK', value: c, pos: start }); i++; continue;
            case ']': tokens.push({ kind: 'RBRACK', value: c, pos: start }); i++; continue;
            case ',': tokens.push({ kind: 'COMMA', value: c, pos: start }); i++; continue;
            case '+': tokens.push({ kind: 'PLUS', value: c, pos: start }); i++; continue;
            case '-': tokens.push({ kind: 'MINUS', value: c, pos: start }); i++; continue;
            case '*': tokens.push({ kind: 'STAR', value: c, pos: start }); i++; continue;
            case '/': tokens.push({ kind: 'SLASH', value: c, pos: start }); i++; continue;
            case '%': tokens.push({ kind: 'PERCENT', value: c, pos: start }); i++; continue;
            case '<': tokens.push({ kind: 'LT', value: c, pos: start }); i++; continue;
            case '>': tokens.push({ kind: 'GT', value: c, pos: start }); i++; continue;
            case '!': tokens.push({ kind: 'NOT', value: c, pos: start }); i++; continue;
            case '?': tokens.push({ kind: 'QMARK', value: c, pos: start }); i++; continue;
            case ':': tokens.push({ kind: 'COLON', value: c, pos: start }); i++; continue;
            default: throw new RuleEvalError(`unexpected character '${c}' at ${i}`);
        }
    }
    tokens.push({ kind: 'EOF', value: '', pos: src.length });
    return tokens;
}

// ── AST ────────────────────────────────────────────────────────────────────

type Node =
    | { type: 'num'; value: number }
    | { type: 'var'; name: string }
    | { type: 'array'; name: string; index: Node }
    | { type: 'call'; name: string; args: Node[] }
    | { type: 'unary'; op: '-' | '!'; arg: Node }
    | { type: 'bin'; op: BinOp; left: Node; right: Node }
    | { type: 'tern'; cond: Node; then: Node; else_: Node };

type BinOp =
    | '+' | '-' | '*' | '/' | '%'
    | '<' | '<=' | '>' | '>=' | '==' | '!='
    | '&&' | '||';

class RuleEvalError extends Error {}

// ── Parser ─────────────────────────────────────────────────────────────────

class Parser {
    private pos = 0;
    constructor(private tokens: Token[]) {}

    parse(): Node {
        const node = this.parseTernary();
        if (this.peek().kind !== 'EOF') {
            throw new RuleEvalError(`unexpected token '${this.peek().value}' at ${this.peek().pos}`);
        }
        return node;
    }

    private peek(offset = 0): Token { return this.tokens[this.pos + offset]; }
    private take(): Token { return this.tokens[this.pos++]; }
    private expect(kind: TokenKind): Token {
        const t = this.take();
        if (t.kind !== kind) throw new RuleEvalError(`expected ${kind}, got ${t.kind} at ${t.pos}`);
        return t;
    }

    private parseTernary(): Node {
        const cond = this.parseLogicOr();
        if (this.peek().kind === 'QMARK') {
            this.take();
            const then = this.parseTernary();
            this.expect('COLON');
            const else_ = this.parseTernary();
            return { type: 'tern', cond, then, else_ };
        }
        return cond;
    }

    private parseLogicOr(): Node {
        let left = this.parseLogicAnd();
        while (this.peek().kind === 'OR') {
            this.take();
            const right = this.parseLogicAnd();
            left = { type: 'bin', op: '||', left, right };
        }
        return left;
    }

    private parseLogicAnd(): Node {
        let left = this.parseEquality();
        while (this.peek().kind === 'AND') {
            this.take();
            const right = this.parseEquality();
            left = { type: 'bin', op: '&&', left, right };
        }
        return left;
    }

    private parseEquality(): Node {
        let left = this.parseCompare();
        while (this.peek().kind === 'EQ' || this.peek().kind === 'NEQ') {
            const op = this.take().kind === 'EQ' ? '==' : '!=';
            const right = this.parseCompare();
            left = { type: 'bin', op, left, right };
        }
        return left;
    }

    private parseCompare(): Node {
        const left = this.parseAdditive();
        const k = this.peek().kind;
        if (k === 'LT' || k === 'LTE' || k === 'GT' || k === 'GTE') {
            const op = ({ LT: '<', LTE: '<=', GT: '>', GTE: '>=' } as const)[k];
            this.take();
            const right = this.parseAdditive();
            return { type: 'bin', op, left, right };
        }
        return left;
    }

    private parseAdditive(): Node {
        let left = this.parseMul();
        while (this.peek().kind === 'PLUS' || this.peek().kind === 'MINUS') {
            const op = this.take().kind === 'PLUS' ? '+' : '-';
            const right = this.parseMul();
            left = { type: 'bin', op, left, right };
        }
        return left;
    }

    private parseMul(): Node {
        let left = this.parseUnary();
        while (
            this.peek().kind === 'STAR' ||
            this.peek().kind === 'SLASH' ||
            this.peek().kind === 'PERCENT'
        ) {
            const k = this.take().kind;
            const op = k === 'STAR' ? '*' : k === 'SLASH' ? '/' : '%';
            const right = this.parseUnary();
            left = { type: 'bin', op, left, right };
        }
        return left;
    }

    private parseUnary(): Node {
        if (this.peek().kind === 'MINUS') { this.take(); return { type: 'unary', op: '-', arg: this.parseUnary() }; }
        if (this.peek().kind === 'NOT')   { this.take(); return { type: 'unary', op: '!', arg: this.parseUnary() }; }
        return this.parsePrimary();
    }

    private parsePrimary(): Node {
        const t = this.peek();
        if (t.kind === 'NUM') { this.take(); return { type: 'num', value: parseFloat(t.value) }; }
        if (t.kind === 'LPAREN') { this.take(); const n = this.parseTernary(); this.expect('RPAREN'); return n; }
        if (t.kind === 'IDENT') {
            this.take();
            if (this.peek().kind === 'LPAREN') {
                this.take();
                const args: Node[] = [];
                if (this.peek().kind !== 'RPAREN') {
                    args.push(this.parseTernary());
                    while (this.peek().kind === 'COMMA') { this.take(); args.push(this.parseTernary()); }
                }
                this.expect('RPAREN');
                return { type: 'call', name: t.value, args };
            }
            if (this.peek().kind === 'LBRACK') {
                this.take();
                const index = this.parseTernary();
                this.expect('RBRACK');
                return { type: 'array', name: t.value, index };
            }
            return { type: 'var', name: t.value };
        }
        throw new RuleEvalError(`unexpected token '${t.value}' at ${t.pos}`);
    }
}

// ── Evaluator ──────────────────────────────────────────────────────────────

const ALLOWED_FUNCS = ['ceil', 'floor', 'round', 'min', 'max', 'abs', 'clamp'] as const;
type AllowedFunc = (typeof ALLOWED_FUNCS)[number];

function callFn(name: string, args: number[]): number {
    if (!ALLOWED_FUNCS.includes(name as AllowedFunc)) {
        throw new RuleEvalError(`unknown function '${name}'`);
    }
    switch (name as AllowedFunc) {
        case 'ceil':  return Math.ceil(args[0]);
        case 'floor': return Math.floor(args[0]);
        case 'round': return Math.round(args[0]);
        case 'min':   return args.length === 0 ? 0 : Math.min(...args);
        case 'max':   return args.length === 0 ? 0 : Math.max(...args);
        case 'abs':   return Math.abs(args[0]);
        case 'clamp': {
            if (args.length !== 3) throw new RuleEvalError('clamp(x, lo, hi) requires 3 args');
            return Math.max(args[1], Math.min(args[2], args[0]));
        }
    }
}

function lookupVar(name: string, ctx: RuleEvalContext): number {
    switch (name) {
        case 'pax':            return ctx.pax;
        case 'room_count':     return ctx.room_count;
        case 'total_sqm':      return ctx.total_sqm;
        case 'duration_min':   return ctx.duration_min;
        case 'bump_in_min':    return ctx.bump_in_min;
        case 'bump_out_min':   return ctx.bump_out_min;
        case 'slice_idx':      return ctx.slice_idx;
        case 'true':           return 1;
        case 'false':          return 0;
        default: throw new RuleEvalError(`unknown variable '${name}'`);
    }
}

function evalNode(node: Node, ctx: RuleEvalContext): number {
    switch (node.type) {
        case 'num': return node.value;
        case 'var': return lookupVar(node.name, ctx);
        case 'array': {
            if (node.name !== 'staff_at_levels') {
                throw new RuleEvalError(`unknown array '${node.name}'`);
            }
            const idx = Math.floor(evalNode(node.index, ctx));
            if (idx < 0 || idx >= ctx.staff_at_levels.length) return 0;
            return ctx.staff_at_levels[idx];
        }
        case 'call': {
            const args = node.args.map((a) => evalNode(a, ctx));
            return callFn(node.name, args);
        }
        case 'unary':
            return node.op === '-' ? -evalNode(node.arg, ctx) : (evalNode(node.arg, ctx) ? 0 : 1);
        case 'bin': {
            const l = evalNode(node.left, ctx);
            // Short-circuit for logic ops
            if (node.op === '&&') return l ? (evalNode(node.right, ctx) ? 1 : 0) : 0;
            if (node.op === '||') return l ? 1 : (evalNode(node.right, ctx) ? 1 : 0);
            const r = evalNode(node.right, ctx);
            switch (node.op) {
                case '+': return l + r;
                case '-': return l - r;
                case '*': return l * r;
                case '/':
                    if (r === 0) throw new RuleEvalError('division by zero');
                    return l / r;
                case '%':
                    if (r === 0) throw new RuleEvalError('modulo by zero');
                    return l % r;
                case '<':  return l < r ? 1 : 0;
                case '<=': return l <= r ? 1 : 0;
                case '>':  return l > r ? 1 : 0;
                case '>=': return l >= r ? 1 : 0;
                case '==': return l === r ? 1 : 0;
                case '!=': return l !== r ? 1 : 0;
            }
            return 0;
        }
        case 'tern':
            return evalNode(node.cond, ctx) ? evalNode(node.then, ctx) : evalNode(node.else_, ctx);
    }
}

// ── Public API ─────────────────────────────────────────────────────────────

export interface CompiledRule {
    rule: DemandRuleRow;
    ast: Node;
    /** True if the formula references staff_at_levels — runs in pass-2 only. */
    dependsOnLevels: boolean;
}

/**
 * Parse a rule's formula once. Returns a CompiledRule that can be evaluated
 * many times (per slice / event) without re-parsing.
 *
 * @throws RuleEvalError if the formula is syntactically invalid.
 */
export function compileRule(rule: DemandRuleRow): CompiledRule {
    const tokens = tokenize(rule.formula);
    const ast = new Parser(tokens).parse();
    const dependsOnLevels = formulaTouchesLevels(ast);
    return { rule, ast, dependsOnLevels };
}

function formulaTouchesLevels(node: Node): boolean {
    switch (node.type) {
        case 'array':  return node.name === 'staff_at_levels' || formulaTouchesLevels(node.index);
        case 'call':   return node.args.some(formulaTouchesLevels);
        case 'unary':  return formulaTouchesLevels(node.arg);
        case 'bin':    return formulaTouchesLevels(node.left) || formulaTouchesLevels(node.right);
        case 'tern':   return formulaTouchesLevels(node.cond)
                          || formulaTouchesLevels(node.then)
                          || formulaTouchesLevels(node.else_);
        default:       return false;
    }
}

/**
 * Evaluate a compiled rule against a context. Returns the formula's numeric
 * result, floored to int and clamped to >= 0 (headcount can't be negative).
 */
export function evaluateRule(compiled: CompiledRule, ctx: RuleEvalContext): number {
    const raw = evalNode(compiled.ast, ctx);
    if (!Number.isFinite(raw)) return 0;
    return Math.max(0, Math.floor(raw));
}

export { RuleEvalError };
