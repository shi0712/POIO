import { app } from 'electron';
import {
  spawn,
  type ChildProcessWithoutNullStreams,
} from 'node:child_process';
import path from 'node:path';
import readline from 'node:readline';
import { existsSync } from 'node:fs';

type JsonObject = Record<string, unknown>;
type PendingCommand = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: NodeJS.Timeout;
};

type SidecarResponse = {
  type: 'response';
  id: string;
  ok: boolean;
  result?: unknown;
  error?: string;
};

type SidecarRequest = {
  type: 'request';
  requestId: string;
  request: string;
  data: unknown;
};

type SidecarEvent = {
  type: 'event';
  event: string;
  data: unknown;
};

export type NativeShareMessage =
  | { kind: 'request'; requestId: string; request: string; data: unknown }
  | { kind: 'event'; event: string; data: unknown }
  | { kind: 'runtime'; state: 'started'|'stopped'|'error'; error?: string };

const commandTimeoutMs = 30_000;

export class NativeShareSidecar {
  private child?: ChildProcessWithoutNullStreams;
  private nextCommandId = 1;
  private pending = new Map<string, PendingCommand>();
  private starting?: Promise<void>;
  private stopping = false;
  private stderrTail = '';

  constructor(
    private readonly developmentRoot: string,
    private readonly publish: (message: NativeShareMessage) => void,
  ) {}

  get available() {
    return existsSync(this.executablePath());
  }

  async command<T = unknown>(method: string, params: JsonObject = {}) {
    await this.ensureStarted();
    const child = this.child;
    if (!child?.stdin.writable) throw new Error('原生屏幕共享进程不可用');
    const id = String(this.nextCommandId++);
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`原生屏幕共享命令超时：${method}`));
      }, commandTimeoutMs);
      timeout.unref();
      this.pending.set(id, {
        resolve: value => resolve(value as T),
        reject,
        timeout,
      });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`, error => {
        if (!error) return;
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        clearTimeout(pending.timeout);
        pending.reject(error);
      });
    });
  }

  async resolveRequest(
    requestId: string,
    ok: boolean,
    result?: unknown,
    error?: string,
  ) {
    await this.ensureStarted();
    const child = this.child;
    if (!child?.stdin.writable) throw new Error('原生屏幕共享进程不可用');
    child.stdin.write(`${JSON.stringify({
      method: 'resolve',
      params: { requestId, ok, result, error },
    })}\n`);
  }

  async stop() {
    this.stopping = true;
    const child = this.child;
    this.child = undefined;
    this.starting = undefined;
    if (!child) {
      this.stopping = false;
      return;
    }
    try {
      if (child.stdin.writable) {
        child.stdin.write(`${JSON.stringify({
          id: `shutdown-${Date.now()}`,
          method: 'shutdown',
          params: {},
        })}\n`);
        child.stdin.end();
      }
    } catch {
      child.kill();
    }
    const timeout = setTimeout(() => child.kill(), 1_500);
    timeout.unref();
    this.rejectAll(new Error('原生屏幕共享进程已停止'));
    this.publish({ kind: 'runtime', state: 'stopped' });
    this.stopping = false;
  }

  private async ensureStarted() {
    if (this.child && !this.child.killed) return;
    if (this.starting) return this.starting;
    this.starting = this.startProcess();
    try {
      await this.starting;
    } finally {
      this.starting = undefined;
    }
  }

  private async startProcess() {
    const executable = this.executablePath();
    if (!executable) throw new Error('未找到原生屏幕共享组件');
    this.stopping = false;
    this.stderrTail = '';
    const child = spawn(executable, [], {
      cwd: path.dirname(executable),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    this.child = child;
    const lines = readline.createInterface({ input: child.stdout });
    lines.on('line', line => this.handleLine(line));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string) => {
      this.stderrTail = `${this.stderrTail}${chunk}`.slice(-4_096);
    });
    child.once('error', error => this.processEnded(child, error));
    child.once('exit', (code, signal) => {
      const detail = this.stderrTail.trim();
      const suffix = detail
        ? `：${detail}`
        : `（退出码 ${code ?? '未知'}${signal ? `，信号 ${signal}` : ''}）`;
      this.processEnded(child, new Error(`原生屏幕共享进程退出${suffix}`));
    });
    await this.commandWithoutStart('hello', {});
    this.publish({ kind: 'runtime', state: 'started' });
  }

  private commandWithoutStart(method: string, params: JsonObject) {
    const child = this.child;
    if (!child?.stdin.writable) return Promise.reject(new Error('原生屏幕共享进程启动失败'));
    const id = String(this.nextCommandId++);
    return new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('原生屏幕共享进程握手超时'));
      }, 10_000);
      timeout.unref();
      this.pending.set(id, { resolve, reject, timeout });
      child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
    });
  }

  private handleLine(line: string) {
    try {
      const message = JSON.parse(line) as SidecarResponse|SidecarRequest|SidecarEvent;
      if (message.type === 'response') {
        const pending = this.pending.get(String(message.id));
        if (!pending) return;
        this.pending.delete(String(message.id));
        clearTimeout(pending.timeout);
        if (message.ok) pending.resolve(message.result);
        else pending.reject(new Error(message.error || '原生屏幕共享命令失败'));
        return;
      }
      if (message.type === 'request') {
        this.publish({
          kind: 'request',
          requestId: message.requestId,
          request: message.request,
          data: message.data,
        });
        return;
      }
      if (message.type === 'event') {
        this.publish({ kind: 'event', event: message.event, data: message.data });
      }
    } catch (error) {
      this.publish({
        kind: 'runtime',
        state: 'error',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private processEnded(child: ChildProcessWithoutNullStreams, error: Error) {
    if (this.child !== child) return;
    this.child = undefined;
    this.starting = undefined;
    this.rejectAll(error);
    if (!this.stopping) {
      this.publish({ kind: 'runtime', state: 'error', error: error.message });
    }
  }

  private rejectAll(error: Error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private executablePath() {
    const candidate = app.isPackaged
      ? path.join(process.resourcesPath, 'share', 'poio-share-sidecar.exe')
      : path.join(
          this.developmentRoot,
          'native',
          'share-core',
          'build-mediasoup',
          'poio-share-sidecar.exe',
        );
    return candidate;
  }
}
