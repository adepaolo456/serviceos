import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotesController } from './notes.controller';
import { CustomerNote } from './note.entity';

@Module({
  imports: [TypeOrmModule.forFeature([CustomerNote])],
  controllers: [NotesController],
})
export class NotesModule {}
