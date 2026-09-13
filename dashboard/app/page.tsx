import WalletProvider from "./connect-wallet";
import Dashboard from "./dashboard";

export default function Home() {
  return <WalletProvider><Dashboard /></WalletProvider>;
}
