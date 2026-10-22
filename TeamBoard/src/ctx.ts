import { createContext, useContext } from 'react';
import type { Board } from './useBoard';
import type { ColId, Task } from './types';

export interface UI {
  board: Board;
  openTask: (id: string) => void;
  /** Move with the evidence rule applied (opens the evidence prompt when needed). */
  move: (task: Task, col: ColId) => Promise<void>;
}
export const UICtx = createContext<UI>(null as unknown as UI);
export const useUI = () => useContext(UICtx);
