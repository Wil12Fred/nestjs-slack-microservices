import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Workspace } from './models/workspace.model';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { UserWorkspace } from './models/userWorkspace.model';

@Injectable()
export class WorkspaceService {
  constructor(
    @InjectRepository(Workspace)
    private repository: Repository<Workspace>,
    @InjectRepository(UserWorkspace)
    private userWorkspaceRepository: Repository<UserWorkspace>,
  ) {}

  async createOne(workspace: any, user: any): Promise<Workspace> {
    try {
      const newWorspace = await this.repository.save(workspace);
      await this.userWorkspaceRepository.save({
        userId: user.userId,
        workspaceId: newWorspace.workspaceId,
      });
      return newWorspace;
    } catch (error) {
      throw error;
    }
  }

  /**
   * THE membership rule, in one place: a user may see or act on a workspace
   * (and its channels) only if a user_workspaces row links them.
   */
  async isMember(userId: number, workspaceId: number): Promise<boolean> {
    if (!Number.isInteger(userId) || !Number.isInteger(workspaceId)) {
      return false;
    }
    const rows = await this.userWorkspaceRepository.count({
      where: { userId, workspaceId },
    });
    return rows > 0;
  }

  /** Throws 403 unless `userId` is a member of `workspaceId`. */
  async assertMember(userId: number, workspaceId: number): Promise<void> {
    if (!(await this.isMember(Number(userId), Number(workspaceId)))) {
      throw new ForbiddenException('Not a member of this workspace');
    }
  }

  /**
   * Adds `invitedUserId` to the workspace. Only a member may invite, and
   * inviting someone who is already a member returns their existing row
   * instead of creating a duplicate.
   */
  async addUserToWorkspace(
    userWorkspace: { workspaceId: number; invitedUserId: number },
    user: { userId: number },
  ): Promise<UserWorkspace> {
    const workspaceId = Number(userWorkspace.workspaceId);
    const invitedUserId = Number(userWorkspace.invitedUserId);
    await this.assertMember(user.userId, workspaceId);
    const existing = await this.userWorkspaceRepository.findOne({
      where: { userId: invitedUserId, workspaceId },
    });
    if (existing) {
      return existing;
    }
    return await this.userWorkspaceRepository.save({
      userId: invitedUserId,
      workspaceId,
    });
  }

  async getOne(workspaceId: number) {
    return await this.repository.findOne({
      where: { workspaceId },
      relations: ['channels'],
    });
  }

  async getAll(userId: number) {
    const userWorkspaces = await this.userWorkspaceRepository.find({
      where: {
        userId,
      },
      relations: ['workspace'],
    });
    return userWorkspaces.map((userWorkspace) => userWorkspace.workspace);
  }

  /**
   * The workspace with its channels, for a member only: 403 for anyone else,
   * 404 if the membership row points at a workspace that no longer exists.
   */
  async getForMember(userId: number, workspaceId: number): Promise<Workspace> {
    await this.assertMember(userId, workspaceId);
    const workspace = await this.getOne(workspaceId);
    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }
    return workspace;
  }
}
