import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Workspace } from './models/workspace.model';
import { Repository } from 'typeorm';
import { InjectRepository } from '@nestjs/typeorm';
import { AuthProvider } from 'src/auth/auth.provider';
import { UserWorkspace } from './models/userWorkspace.model';

/** The caller, as ApiGuard put it on the request from ms_auth's answer. */
export interface Caller {
  userId: number;
  accountId: number;
}

@Injectable()
export class WorkspaceService {
  constructor(
    @InjectRepository(Workspace)
    private repository: Repository<Workspace>,
    @InjectRepository(UserWorkspace)
    private userWorkspaceRepository: Repository<UserWorkspace>,
    private readonly authProvider: AuthProvider,
  ) {}

  /** Creates a workspace in the caller's account (the token's) and joins it. */
  async createOne(
    workspace: { name: string },
    user: Caller,
  ): Promise<Workspace> {
    const newWorspace = await this.repository.save({
      name: workspace.name,
      accountId: Number(user.accountId),
    });
    await this.userWorkspaceRepository.save({
      userId: user.userId,
      workspaceId: newWorspace.workspaceId,
    });
    return newWorspace;
  }

  /**
   * THE membership rule, in one place: a user may see or act on a workspace
   * (and its channels) only if a user_workspaces row links them, and only
   * with a token for the workspace's account (the token's accountId, never a
   * header).
   */
  async isMember(
    userId: number,
    workspaceId: number,
    accountId: number,
  ): Promise<boolean> {
    if (
      !Number.isInteger(userId) ||
      !Number.isInteger(workspaceId) ||
      !Number.isInteger(accountId)
    ) {
      return false;
    }
    const rows = await this.userWorkspaceRepository.count({
      where: { userId, workspaceId },
    });
    if (rows === 0) {
      return false;
    }
    const workspace = await this.repository.findOne({ where: { workspaceId } });
    // a membership row whose workspace is gone is left to the caller's 404
    return !workspace || Number(workspace.accountId) === accountId;
  }

  /** Throws 403 unless the caller is a member of `workspaceId`. */
  async assertMember(user: Caller, workspaceId: number): Promise<void> {
    const allowed = await this.isMember(
      Number(user?.userId),
      Number(workspaceId),
      Number(user?.accountId),
    );
    if (!allowed) {
      throw new ForbiddenException('Not a member of this workspace');
    }
  }

  /**
   * Adds `invitedUserId` to the workspace. Only a member may invite (checked
   * first, so a non-member learns nothing about the invitee); the invitee
   * must be a user ms_auth shows the caller, i.e. one that exists in the
   * caller's account (404 otherwise). Inviting someone who is already a
   * member returns their existing row instead of creating a duplicate.
   */
  async addUserToWorkspace(
    userWorkspace: { workspaceId: number; invitedUserId: number },
    user: Caller,
    authorization: string,
  ): Promise<UserWorkspace> {
    const workspaceId = Number(userWorkspace.workspaceId);
    const invitedUserId = Number(userWorkspace.invitedUserId);
    await this.assertMember(user, workspaceId);
    const invitee = await this.authProvider.getUser(
      authorization,
      invitedUserId,
    );
    if (!invitee) {
      throw new NotFoundException('User not found');
    }
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

  /** The caller's workspaces in the token's account. */
  async getAll(user: Caller) {
    const userWorkspaces = await this.userWorkspaceRepository.find({
      where: {
        userId: user.userId,
      },
      relations: ['workspace'],
    });
    return userWorkspaces
      .map((userWorkspace) => userWorkspace.workspace)
      .filter(
        (workspace) =>
          workspace && Number(workspace.accountId) === Number(user.accountId),
      );
  }

  /**
   * The workspace with its channels, for a member only: 403 for anyone else,
   * 404 if the membership row points at a workspace that no longer exists.
   */
  async getForMember(user: Caller, workspaceId: number): Promise<Workspace> {
    await this.assertMember(user, workspaceId);
    const workspace = await this.getOne(workspaceId);
    if (!workspace) {
      throw new NotFoundException('Workspace not found');
    }
    return workspace;
  }
}
