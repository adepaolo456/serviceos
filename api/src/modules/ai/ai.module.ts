import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AiSuggestionLog } from './entities/ai-suggestion-log.entity';

@Module({
  imports: [TypeOrmModule.forFeature([AiSuggestionLog])],
  controllers: [AiController],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
