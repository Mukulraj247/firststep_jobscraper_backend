import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { GlobalInfoProvider } from "./context/globalInfo";
import { PageWrapper } from "./pages/PageWrapper";
import "./i18n";
import ThemeModeProvider from './context/theme-provider';

function App() {
  return (
    <BrowserRouter>
      <ThemeModeProvider>
        <GlobalInfoProvider>
          <Routes>
            <Route path="/*" element={<PageWrapper />} />
          </Routes>
        </GlobalInfoProvider>
      </ThemeModeProvider>
    </BrowserRouter>
  );
}

export default App;
