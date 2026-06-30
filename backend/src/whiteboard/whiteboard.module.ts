import { Module } from '@nestjs/common';
import { WhiteboardGateway } from './whiteboard.gateway';
import { WhiteboardService } from './whiteboard.service';

@Module({
  providers: [WhiteboardGateway, WhiteboardService],
})
export class WhiteboardModule {}
