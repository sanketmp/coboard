import { Module } from '@nestjs/common';
// import { ServeStaticModule } from '@nestjs/serve-static';
// import { join } from 'path';
import { WhiteboardModule } from './whiteboard/whiteboard.module';

@Module({
  imports: [WhiteboardModule],
})
export class AppModule {}
