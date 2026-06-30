import { Module } from '@nestjs/common';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'path';
import { WhiteboardModule } from './whiteboard/whiteboard.module';

@Module({
  imports: [
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', '..', 'client'),
      serveStaticOptions: { etag: false, maxAge: 0 },
    }),
    WhiteboardModule,
  ],
})
export class AppModule {}
