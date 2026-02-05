import { BrowserRouter, Routes, Route } from 'react-router-dom';
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
import { AuthProvider } from './context/AuthContext';
import { EconomyProvider } from './context/EconomyContext';

function App() {
  return (
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
              <Route path="contact" element={<Contact />} />
              <Route path="login" element={<Login />} />
              <Route path="register" element={<Register />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </EconomyProvider>
    </AuthProvider>
  );
}

export default App;
