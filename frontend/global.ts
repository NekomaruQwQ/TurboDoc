import { createContext } from "react";

import type { Workspace } from '@/data';

export const WorkspaceContext =
    createContext<[Workspace, (value: Workspace) => void]>(undefined!);
