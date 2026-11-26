import { Test, TestingModule } from '@nestjs/testing';
import { WorkspaceService } from './workspace.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Workspace } from './models/workspace.model';
import { UserWorkspace } from './models/userWorkspace.model';
import { AuthProvider } from '../auth/auth.provider';

describe('WorkspaceService', () => {
  let service: WorkspaceService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkspaceService,
        { provide: getRepositoryToken(Workspace), useValue: {} },
        { provide: getRepositoryToken(UserWorkspace), useValue: {} },
        { provide: AuthProvider, useValue: {} },
      ],
    }).compile();

    service = module.get<WorkspaceService>(WorkspaceService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
