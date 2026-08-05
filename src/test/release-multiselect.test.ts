import * as assert from 'assert';
import * as vm from 'vm';
import { ReleaseWebviewPanel } from '../release/releaseWebviewPanel';

function makeElement(id?: string, className?: string): any {
    const el: any = {
        id: id || '',
        className: className || '',
        classList: {
            _classes: new Set((className || '').split(' ').filter(Boolean)),
            add(c: string) { this._classes.add(c); el.className = Array.from(this._classes).join(' '); },
            remove(c: string) { this._classes.delete(c); el.className = Array.from(this._classes).join(' '); },
            toggle(c: string, force?: boolean) {
                if (force === undefined) force = !this._classes.has(c);
                if (force) { this.add(c); } else { this.remove(c); }
            },
            contains(c: string) { return this._classes.has(c); }
        },
        dataset: {} as Record<string, string>,
        children: [] as any[],
        innerHTML: '',
        innerText: '',
        style: {} as Record<string, string>,
        checked: false,
        hidden: false,
        parentElement: null as any,
        _checkbox: null as any,
        _titleText: '',
        _emptyBucket: null as any,
        querySelector(sel: string) {
            if (sel === '.c-checkbox') return el._checkbox || null;
            if (sel === '.tb-title') return { innerText: el._titleText || '' };
            if (sel === '.empty-bucket') return el._emptyBucket || null;
            return null;
        },
        querySelectorAll() { return []; },
        appendChild(child: any) { el.children.push(child); child.parentElement = el; },
        closest(sel: string) { return sel === '#commit-pool' && el.parentElement?.id === 'commit-pool' ? el.parentElement : null; },
        addEventListener() {},
        setAttribute() {},
        remove() {}
    };
    return el;
}

function createSandbox() {
    const elements: Record<string, any> = {};
    const pool = makeElement('commit-pool', 'commit-pool');
    const batchBar = makeElement('batch-bar', 'batch-bar');
    const batchCount = makeElement('batch-count');
    const movePicker = makeElement('move-picker', 'move-picker');
    elements['commit-pool'] = pool;
    elements['batch-bar'] = batchBar;
    elements['batch-count'] = batchCount;
    elements['move-picker'] = movePicker;

    const postedMessages: any[] = [];

    // Return a stub element for any ID not explicitly registered
    const stubElement = () => makeElement();

    const sandbox: any = {
        document: {
            getElementById(id: string) { return elements[id] || stubElement(); },
            querySelectorAll(sel: string) {
                if (sel === '#commit-pool .commit-card') return pool.children;
                if (sel === '.ticket-bucket') return Object.values(elements).filter((e: any) => (e.className || '').includes('ticket-bucket'));
                if (sel === '.filter-btn') return [];
                return [];
            },
            querySelector() { return null; },
            createElement() { return makeElement(); },
            addEventListener() {}
        },
        acquireVsCodeApi() {
            return { postMessage(msg: any) { postedMessages.push(msg); }, getState() { return {}; }, setState() {} };
        },
        Set, Array, Object, JSON, Date, RegExp, Map, console, parseInt, String, Boolean, Number, Error, Promise,
        setTimeout: (fn: any) => fn(),
        Diff2HtmlUI: class { draw() {} },
        navigator: { clipboard: { writeText: async () => {} } },
        window: { addEventListener() {}, location: { href: '' } },
        alert() {},
        confirm() { return true; }
    };

    return { sandbox, pool, elements, postedMessages, batchBar, batchCount, movePicker };
}

function getWebviewScript(): string {
    const panel = {
        title: '',
        webview: {
            html: '',
            asWebviewUri: (uri: any) => uri,
            onDidReceiveMessage: () => ({ dispose: () => {} }),
            postMessage: async () => true
        },
        onDidDispose: () => ({ dispose: () => {} }),
        dispose: () => {},
        reveal: () => {}
    };
    const context = {
        extensionUri: { fsPath: '/tmp/ext' },
        secrets: { get: async () => undefined, store: async () => {} },
        workspaceState: { get: (_k: string, f: any) => f, update: async () => {} }
    };
    const instance = new (ReleaseWebviewPanel as any)(panel, context, '/tmp/ws');
    const html: string = (instance as any)._getHtmlForWebview(panel.webview, 'a', 'b', 'c');
    // Match the last <script> block (the inline app logic, not CDN libs)
    const allScripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)];
    const lastScript = allScripts[allScripts.length - 1];
    assert.ok(lastScript, 'Inline script block must exist');
    return lastScript[1];
}

function runInSandbox(sandbox: any): any {
    const script = getWebviewScript();
    const ctx = vm.createContext(sandbox);
    vm.runInContext(script, ctx);
    // Expose let-scoped variables via helper accessors
    vm.runInContext(`
        this.__getMultiSelected = () => multiSelected;
        this.__getLastClickedHash = () => lastClickedHash;
        this.__handleMultiSelect = handleMultiSelect;
        this.__clearMultiSelect = clearMultiSelect;
        this.__updateBatchBar = updateBatchBar;
        this.__moveSelectedToTicket = moveSelectedToTicket;
        this.__showMovePicker = showMovePicker;
    `, ctx);
    return {
        get multiSelected() { return ctx.__getMultiSelected(); },
        get lastClickedHash() { return ctx.__getLastClickedHash(); },
        handleMultiSelect: ctx.__handleMultiSelect,
        clearMultiSelect: ctx.__clearMultiSelect,
        updateBatchBar: ctx.__updateBatchBar,
        moveSelectedToTicket: ctx.__moveSelectedToTicket,
        showMovePicker: ctx.__showMovePicker
    };
}

function addCommitCard(pool: any, elements: Record<string, any>, hash: string) {
    const card = makeElement('c-' + hash, 'commit-card');
    card.dataset = { hash };
    card._checkbox = { checked: false, classList: { contains: () => false } };
    pool.appendChild(card);
    elements['c-' + hash] = card;
    return card;
}

suite('Multi-Select Commit Logic', () => {

    test('handleMultiSelect toggles a commit into selection', () => {
        const { sandbox, pool, elements } = createSandbox();
        addCommitCard(pool, elements, 'hash1');

        const ctx = runInSandbox(sandbox);
        ctx.handleMultiSelect('hash1', { shiftKey: false });

        assert.ok(ctx.multiSelected.has('hash1'));
        assert.ok(elements['c-hash1'].classList.contains('multi-selected'));
        assert.strictEqual(elements['c-hash1']._checkbox.checked, true);
    });

    test('handleMultiSelect deselects already-selected commit', () => {
        const { sandbox, pool, elements } = createSandbox();
        addCommitCard(pool, elements, 'hash1');

        const ctx = runInSandbox(sandbox);
        ctx.handleMultiSelect('hash1', { shiftKey: false });
        ctx.handleMultiSelect('hash1', { shiftKey: false });

        assert.ok(!ctx.multiSelected.has('hash1'));
        assert.ok(!elements['c-hash1'].classList.contains('multi-selected'));
        assert.strictEqual(elements['c-hash1']._checkbox.checked, false);
    });

    test('handleMultiSelect with shift selects a range', () => {
        const { sandbox, pool, elements } = createSandbox();
        const hashes = ['h1', 'h2', 'h3', 'h4'];
        hashes.forEach(h => addCommitCard(pool, elements, h));

        const ctx = runInSandbox(sandbox);
        ctx.handleMultiSelect('h1', { shiftKey: false });
        ctx.handleMultiSelect('h4', { shiftKey: true });

        assert.strictEqual(ctx.multiSelected.size, 4);
        hashes.forEach(h => assert.ok(ctx.multiSelected.has(h), h + ' should be selected'));
    });

    test('handleMultiSelect shift range works in reverse order', () => {
        const { sandbox, pool, elements } = createSandbox();
        ['h1', 'h2', 'h3'].forEach(h => addCommitCard(pool, elements, h));

        const ctx = runInSandbox(sandbox);
        ctx.handleMultiSelect('h3', { shiftKey: false });
        ctx.handleMultiSelect('h1', { shiftKey: true });

        assert.strictEqual(ctx.multiSelected.size, 3);
    });

    test('clearMultiSelect removes all selections and resets state', () => {
        const { sandbox, pool, elements } = createSandbox();
        ['h1', 'h2'].forEach(h => addCommitCard(pool, elements, h));

        const ctx = runInSandbox(sandbox);
        ctx.handleMultiSelect('h1', { shiftKey: false });
        ctx.handleMultiSelect('h2', { shiftKey: false });
        assert.strictEqual(ctx.multiSelected.size, 2);

        ctx.clearMultiSelect();
        assert.strictEqual(ctx.multiSelected.size, 0);
        assert.strictEqual(ctx.lastClickedHash, null);
        assert.ok(!elements['c-h1'].classList.contains('multi-selected'));
        assert.ok(!elements['c-h2'].classList.contains('multi-selected'));
    });

    test('updateBatchBar toggles visibility based on selection count', () => {
        const { sandbox, pool, elements, batchBar, batchCount } = createSandbox();
        addCommitCard(pool, elements, 'h1');

        const ctx = runInSandbox(sandbox);

        ctx.handleMultiSelect('h1', { shiftKey: false });
        assert.ok(batchBar.classList.contains('visible'));
        assert.strictEqual(batchCount.innerText, '1 selected');

        ctx.clearMultiSelect();
        assert.ok(!batchBar.classList.contains('visible'));
        assert.strictEqual(batchCount.innerText, '0 selected');
    });

    test('moveSelectedToTicket moves commits to ticket bucket and clears selection', () => {
        const { sandbox, pool, elements, batchBar } = createSandbox();
        addCommitCard(pool, elements, 'h1');
        addCommitCard(pool, elements, 'h2');

        const tbContent = makeElement('content-T1', '');
        tbContent._emptyBucket = { remove() { tbContent._emptyBucket = null; } };
        elements['content-T1'] = tbContent;

        const ctx = runInSandbox(sandbox);
        ctx.handleMultiSelect('h1', { shiftKey: false });
        ctx.handleMultiSelect('h2', { shiftKey: false });

        ctx.moveSelectedToTicket('T1');

        assert.strictEqual(ctx.multiSelected.size, 0);
        assert.strictEqual(tbContent.children.length, 2);
        assert.strictEqual(tbContent.children[0].dataset.hash, 'h1');
        assert.strictEqual(tbContent.children[1].dataset.hash, 'h2');
        assert.ok(!batchBar.classList.contains('visible'));
    });

    test('moveSelectedToTicket only moves commits that are in the pool', () => {
        const { sandbox, pool, elements } = createSandbox();
        const card1 = addCommitCard(pool, elements, 'h1');
        addCommitCard(pool, elements, 'h2');

        // Simulate h1 already in another bucket
        card1.closest = () => null;

        const tbContent = makeElement('content-T2', '');
        elements['content-T2'] = tbContent;

        const ctx = runInSandbox(sandbox);
        ctx.multiSelected.add('h1');
        ctx.multiSelected.add('h2');

        ctx.moveSelectedToTicket('T2');

        assert.strictEqual(tbContent.children.length, 1);
        assert.strictEqual(tbContent.children[0].dataset.hash, 'h2');
    });
});
