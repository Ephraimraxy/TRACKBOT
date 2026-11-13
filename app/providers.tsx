"use client";

import { useState } from "react";
import { Session } from "next-auth";
import { SessionProvider } from "next-auth/react";
import { Provider as ReduxProvider } from "react-redux";
import { PersistGate } from "redux-persist/integration/react";

// Redux
import { makeStore } from "@/redux/store";

// UI components
import SpinnerbLoader from "@/components/ui/SpinnerLoader";
import LiveNotifications from "@/components/notifications/LiveNotifications";

type Props = {
  children: React.ReactNode;
  session?: Session;
};

const Providers = ({ children, session }: Props) => {
  // Create the store ONCE. Calling makeStore() on every render built a new store and persistence gate
  // each time the page changed, which restarted the whole app (cart reload, sidebar reset) on every click.
  const [{ store, persistor }] = useState(makeStore);

  return (
    <SessionProvider session={session}>
      <ReduxProvider store={store}>
        <PersistGate
          loading={
            <div className="flex items-center justify-center h-96">
              <SpinnerbLoader className="w-10 border-2 border-gray-300 border-r-gray-600" />
            </div>
          }
          persistor={persistor}
        >
          {children}
          <LiveNotifications />
        </PersistGate>
      </ReduxProvider>
    </SessionProvider>
  );
};

export default Providers;
