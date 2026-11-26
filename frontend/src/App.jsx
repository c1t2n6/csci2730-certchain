import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { WalletProvider } from "./lib/wallet";
import Layout from "./components/Layout";
import Home from "./pages/Home";
import Verify from "./pages/Verify";
import Student from "./pages/Student";
import IssuerConsole from "./pages/issuer/IssuerConsole";
import Overview from "./pages/issuer/Overview";
import IssueForm from "./pages/issuer/IssueForm";
import BatchIssue from "./pages/issuer/BatchIssue";
import CertificateList from "./pages/issuer/CertificateList";
import Institutions from "./pages/issuer/Institutions";

export default function App() {
  return (
    <WalletProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="verify" element={<Verify />} />
            <Route path="verify/:certId" element={<Verify />} />
            <Route path="student" element={<Student />} />
            <Route path="issuer" element={<IssuerConsole />}>
              <Route index element={<Overview />} />
              <Route path="issue" element={<IssueForm />} />
              <Route path="batch" element={<BatchIssue />} />
              <Route path="certificates" element={<CertificateList />} />
              <Route path="institutions" element={<Institutions />} />
            </Route>
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </WalletProvider>
  );
}
