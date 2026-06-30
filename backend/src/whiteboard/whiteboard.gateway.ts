import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { WhiteboardService } from './whiteboard.service';

@WebSocketGateway({ cors: {
  origin:[
    'http://localhost:3000'
  ],
} })
export class WhiteboardGateway implements OnGatewayDisconnect {
  @WebSocketServer()
  private readonly server: Server;

  constructor(private readonly whiteboardService: WhiteboardService) {}

  @SubscribeMessage('create-room')
  onCreateRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { name: string },
  ) {
    const result = this.whiteboardService.createRoom(client.id, data?.name);
    client.join(result.roomId);
    client.emit('room-joined', result);
  }

  @SubscribeMessage('join-room')
  onJoinRoom(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { name: string; roomId: string },
  ) {
    const result = this.whiteboardService.joinRoom(client.id, data?.name, String(data?.roomId ?? ''));
    if (!result) {
      client.emit('room-error', { message: 'Whiteboard not found. Check the ID and try again.' });
      return;
    }
    client.join(result.roomId);
    client.emit('room-joined', result);
  }

  @SubscribeMessage('draw-line')
  onDrawLine(
    @ConnectedSocket() client: Socket,
    @MessageBody() rawSegment: unknown,
  ) {
    const session = this.whiteboardService.getSession(client.id);
    if (!session) return;
    const segment = this.whiteboardService.normalizeSegment(rawSegment);
    if (!segment) return;
    this.whiteboardService.addLine(session.roomId, segment);
    client.to(session.roomId).emit('draw-line', segment);
  }

  @SubscribeMessage('clear-canvas')
  onClearCanvas(@ConnectedSocket() client: Socket) {
    const session = this.whiteboardService.getSession(client.id);
    if (!session) return;
    this.whiteboardService.clearRoom(session.roomId);
    this.server.to(session.roomId).emit('clear-canvas');
  }

  @SubscribeMessage('cursor-move')
  onCursorMove(
    @ConnectedSocket() client: Socket,
    @MessageBody() rawPoint: unknown,
  ) {
    const session = this.whiteboardService.getSession(client.id);
    if (!session) return;
    const point = this.whiteboardService.validatePoint(rawPoint);
    if (!point) return;
    client.to(session.roomId).emit('cursor-move', {
      id: client.id,
      x: point.x,
      y: point.y,
      name: session.name,
      color: session.color,
    });
  }

  @SubscribeMessage('undo-stroke')
  onUndoStroke(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { strokeId: string },
  ) {
    if (typeof data?.strokeId !== 'string' || data.strokeId.length > 64) return;
    const session = this.whiteboardService.getSession(client.id);
    if (!session) return;
    this.whiteboardService.undoStroke(session.roomId, data.strokeId);
    client.to(session.roomId).emit('undo-stroke', { strokeId: data.strokeId });
  }

  @SubscribeMessage('redo-stroke')
  onRedoStroke(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { strokeId: string; segments: unknown[] },
  ) {
    if (typeof data?.strokeId !== 'string' || data.strokeId.length > 64) return;
    if (!Array.isArray(data?.segments) || data.segments.length > 10_000) return;
    const session = this.whiteboardService.getSession(client.id);
    if (!session) return;
    const normalized = data.segments
      .map((s) => this.whiteboardService.normalizeSegment(s))
      .filter(Boolean);
    this.whiteboardService.redoStroke(session.roomId, normalized);
    client.to(session.roomId).emit('redo-stroke', { strokeId: data.strokeId, segments: normalized });
  }

  handleDisconnect(client: Socket) {
    const session = this.whiteboardService.removeSession(client.id);
    if (session) {
      client.to(session.roomId).emit('cursor-remove', client.id);
    }
  }
}
