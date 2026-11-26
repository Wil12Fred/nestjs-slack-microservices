import { Test, TestingModule } from '@nestjs/testing';
import { WorkspaceController } from './workspace.controller';
import { WorkspaceService } from './workspace.service';
import { AuthProvider } from '../auth/auth.provider';

describe('WorkspaceController', () => {
  let controller: WorkspaceController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WorkspaceController],
      providers: [
        { provide: WorkspaceService, useValue: {} },
        { provide: AuthProvider, useValue: {} },
      ],
    }).compile();

    controller = module.get<WorkspaceController>(WorkspaceController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
