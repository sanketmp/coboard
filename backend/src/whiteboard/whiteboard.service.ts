import { Injectable } from '@nestjs/common';

const COORD_LIMIT = 1e7;

function randomColor(): string {
  return '#' + Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0');
}




interface Point {
  x: number;
  y: number;
}

export interface Segment {
  from: Point;
  to: Point;
  strokeId?: string;
}

interface Room {
  lines: Segment[];
}

export interface Session {
  color: string;
  name: string;
  roomId: string;
}

@Injectable()
export class WhiteboardService {
  private readonly rooms = new Map<string, Room>();
  private readonly sessions = new Map<string, Session>();

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private generateRoomId(): string {
    let id: string;
    do {
      id = String(Math.floor(100000 + Math.random() * 900000));
    } while (this.rooms.has(id));
    return id;
  }

  private sanitizeName(raw: unknown): string {
    return String(raw ?? '').trim().slice(0, 24) || 'Anonymous';
  }

  validatePoint(point: unknown): Point | null {
    const p = point as any;
    const x = Number(p?.x);
    const y = Number(p?.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
    return {
      x: Math.max(-COORD_LIMIT, Math.min(COORD_LIMIT, x)),
      y: Math.max(-COORD_LIMIT, Math.min(COORD_LIMIT, y)),
    };
  }

  normalizeSegment(segment: unknown): Segment | null {
    const s = segment as any;
    if (!s) return null;
    const from = this.validatePoint(s.from);
    const to = this.validatePoint(s.to);
    if (!from || !to) return null;
    const strokeId =
      typeof s.strokeId === 'string' ? s.strokeId.slice(0, 64) : undefined;
    return strokeId ? { from, to, strokeId } : { from, to };
  }

  // ── Room management ───────────────────────────────────────────────────────────

  createRoom(socketId: string, name: unknown) {
    const roomId = this.generateRoomId();
    this.rooms.set(roomId, { lines: [] });
    const color = randomColor();
    this.sessions.set(socketId, { color, name: this.sanitizeName(name), roomId });
    return { roomId, color, lines: [] as Segment[] };
  }

  joinRoom(socketId: string, name: unknown, roomId: string) {
    const id = String(roomId);
    const room = this.rooms.get(id);
    if (!room) return null;
    const color = randomColor();
    this.sessions.set(socketId, { color, name: this.sanitizeName(name), roomId: id });
    return { roomId: id, color, lines: room.lines };
  }

  getSession(socketId: string): Session | undefined {
    return this.sessions.get(socketId);
  }

  removeSession(socketId: string): Session | undefined {
    const session = this.sessions.get(socketId);
    if (session) this.sessions.delete(socketId);
    return session;
  }

  // ── Canvas operations ─────────────────────────────────────────────────────────

  addLine(roomId: string, segment: Segment): void {
    this.rooms.get(roomId)?.lines.push(segment);
  }

  clearRoom(roomId: string): void {
    const room = this.rooms.get(roomId);
    if (room) room.lines = [];
  }

  undoStroke(roomId: string, strokeId: string): void {
    const room = this.rooms.get(roomId);
    if (room) room.lines = room.lines.filter((s) => s.strokeId !== strokeId);
  }

  redoStroke(roomId: string, segments: Segment[]): void {
    this.rooms.get(roomId)?.lines.push(...segments);
  }
}
