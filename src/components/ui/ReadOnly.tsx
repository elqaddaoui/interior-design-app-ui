import React, { createContext, useContext } from 'react';

/**
 * View-only mode of an admin page (the signed-in administrator's plan or role gives the page level "view").
 * The admin shell provides it; the shared controls (Button, Toggle, Checkbox, Slider, Input) read it and switch themselves off,
 * unless the control is marked `safe` (it changes nothing: open WhatsApp, search, cancel, close ...).
 * The default is false, so the end-user app is never affected. The server refuses the writes as well.
 */
const ReadOnlyContext = createContext(false);
export const ReadOnlyProvider = ({ value, children }: { value: boolean; children: React.ReactNode }) => <ReadOnlyContext.Provider value={value}>{children}</ReadOnlyContext.Provider>;
export const useReadOnly = () => useContext(ReadOnlyContext);
