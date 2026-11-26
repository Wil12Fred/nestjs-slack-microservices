import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { AuthProvider } from './auth.provider';

@Module({
  imports: [HttpModule.register({ timeout: 5000 })],
  providers: [AuthProvider],
  exports: [AuthProvider],
})
export class AuthModule {}
