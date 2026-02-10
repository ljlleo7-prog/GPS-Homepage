import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { I18nextProvider } from 'react-i18next';
import i18n from './i18n';
import Layout from './components/layout/Layout';
import Home from './pages/Home';
import News from './pages/News';
import ArticleDetails from './pages/ArticleDetails';
import About from './pages/About';
import Contact from './pages/Contact';
import Login from './pages/Login';
import Register from './pages/Register';
import Products from './pages/Products';
import Wallet from './pages/Wallet';
import Missions from './pages/Missions';
import SupportMarkets from './pages/SupportMarkets';
import Forum from './pages/Forum';
import DeveloperInbox from './pages/DeveloperInbox';
import Minigame from './pages/Minigame';
import { AuthProvider } from './context/AuthContext';
import { EconomyProvider } from './context/EconomyContext';

function App() {
  return (
    <I18nextProvider i18n={i18n}>
      <AuthProvider>
        <EconomyProvider>
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<Layout />}>
                <Route index element={<Home />} />
                <Route path="news" element={<News />} />
                <Route path="news/:id" element={<ArticleDetails />} />
                <Route path="about" element={<About />} />
                <Route path="products" element={<Products />} />
                <Route path="wallet" element={<Wallet />} />
                <Route path="missions" element={<Missions />} />
                <Route path="markets" element={<SupportMarkets />} />
                <Route path="minigame" element={<Minigame />} />
                <Route path="community" element={<Forum />} />
                <Route path="developer-inbox" element={<DeveloperInbox />} />
                <Route path="contact" element={<Contact />} />
                <Route path="login" element={<Login />} />
                <Route path="register" element={<Register />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </EconomyProvider>
      </AuthProvider>
    </I18nextProvider>
  );
}

export default App;
