import type { ThemeSetting } from '$lib/managers/theme-manager.svelte';
import type { ReleaseEvent } from '$lib/types';
import { BaseEventManager } from '$lib/utils/base-event-manager.svelte';
import type { TreeNode } from '$lib/utils/tree-utils';
import type {
  AlbumResponseDto,
  AlbumUserRole,
  ApiKeyResponseDto,
  AssetResponseDto,
  LibraryResponseDto,
  LoginResponseDto,
  PersonResponseDto,
  QueueResponseDto,
  SharedLinkResponseDto,
  SystemConfigDto,
  TagResponseDto,
  UserAdminResponseDto,
  WorkflowResponseDto,
} from '@immich/sdk';

export type Events = {
  AlbumAddAssets: [{ assetIds: string[]; albumIds: string[] }];
  AlbumCreate: [AlbumResponseDto];
  AlbumDelete: [AlbumResponseDto];
  AlbumShare: [];
  AlbumUpdate: [AlbumResponseDto];
  AlbumUserDelete: [{ albumId: string; userId: string }];
  AlbumUserUpdate: [{ albumId: string; userId: string; role: AlbumUserRole }];

  ApiKeyCreate: [ApiKeyResponseDto];
  ApiKeyDelete: [ApiKeyResponseDto];
  ApiKeyUpdate: [ApiKeyResponseDto];

  AppInit: [];

  AssetEditsApplied: [string];
  AssetUpdate: [AssetResponseDto];
  AssetViewerAfterNavigate: [];
  AssetsArchive: [string[]];
  AssetsDelete: [string[]];
  AssetsTag: [string[]];

  AuthLogin: [LoginResponseDto];
  AuthLogout: [];
  AuthUserLoaded: [UserAdminResponseDto];

  BackupDeleteStatus: [{ filename: string; isDeleting: boolean }];
  BackupDeleted: [{ filename: string }];
  BackupUpload: [{ progress: number; isComplete: boolean }];

  LanguageChange: [{ name: string; code: string; rtl?: boolean }];

  LibraryCreate: [LibraryResponseDto];
  LibraryDelete: [{ id: string }];
  LibraryUpdate: [LibraryResponseDto];

  PersonAssetDelete: [{ id: string; assetId: string }];
  PersonThumbnailReady: [{ id: string }];
  PersonUpdate: [PersonResponseDto];

  QueueUpdate: [QueueResponseDto];

  ReleaseEvent: [ReleaseEvent];

  SessionLocked: [];

  SharedLinkCreate: [SharedLinkResponseDto];
  SharedLinkDelete: [SharedLinkResponseDto];
  SharedLinkUpdate: [SharedLinkResponseDto];

  SystemConfigUpdate: [SystemConfigDto];

  TagCreate: [TagResponseDto];
  TagDelete: [TreeNode];
  TagUpdate: [TagResponseDto];

  ThemeChange: [ThemeSetting];

  TimelineLoaded: [{ id: string | null }];
  TransitionToAssetViewer: [];
  TransitionToAssetViewerReady: [];
  TransitionToTimeline: [{ id: string }];
  TransitionToTimelineReady: [];

  UserAdminCreate: [UserAdminResponseDto];
  // soft deleted
  UserAdminDelete: [UserAdminResponseDto];
  // confirmed permanently deleted from server
  UserAdminDeleted: [{ id: string }];
  UserAdminRestore: [UserAdminResponseDto];
  UserAdminUpdate: [UserAdminResponseDto];
  UserPinCodeReset: [];

  WebsocketConnect: [];

  WorkflowCreate: [WorkflowResponseDto];
  WorkflowDelete: [WorkflowResponseDto];
  WorkflowUpdate: [WorkflowResponseDto];
};

export const eventManager = new BaseEventManager<Events>();
