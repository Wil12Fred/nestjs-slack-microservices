import { Module } from '@nestjs/common';
import { WorkspaceService } from './workspace.service';
import { WorkspaceController } from './workspace.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Workspace } from './models/workspace.model';
import { AuthModule } from 'src/auth/auth.module';
import { UserWorkspace } from './models/userWorkspace.model';

@Module({
  imports: [TypeOrmModule.forFeature([Workspace, UserWorkspace]), AuthModule],
  providers: [WorkspaceService],
  controllers: [WorkspaceController],
  exports: [WorkspaceService],
})
export class WorkspaceModule {}
