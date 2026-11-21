import { createContext, useContext } from 'react';

export const ChatContext = createContext({ socket: null, unread: 0, refreshUnread: () => {} });

/** The live chat connection (or null) and the unread message count. */
export const useChat = () => useContext(ChatContext);
