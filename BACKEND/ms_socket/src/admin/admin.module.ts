import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { AdminProvider } from './admin.provider';

@Module({
  imports: [HttpModule.register({ timeout: 5000 })],
  providers: [AdminProvider],
  exports: [AdminProvider],
})
export class AdminModule {}
