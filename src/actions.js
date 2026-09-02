/**
 * The human's actions, shared between the side panel and the controls that
 * appear on the cards themselves. A context rather than a prop chain, because
 * React Flow builds the nodes and there is nowhere to thread props through.
 */
import { createContext, useContext } from 'react';

export const Actions = createContext(null);
export const useActions = () => useContext(Actions);
