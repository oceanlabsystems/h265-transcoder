import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  ConsoleSqlOutlined,
  HomeOutlined,
  KeyOutlined,
  QuestionCircleOutlined,
  SettingOutlined,
} from "@ant-design/icons";
import { ElectronAPI } from "@electron-toolkit/preload";
import "@renderer/assets/index.css";
import "@renderer/assets/modal.css";
import { ConfigProvider, Layout, Menu, Typography, theme } from "antd";
import { useEffect, useState } from "react";
import {
  HashRouter as Router,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { Toaster } from "sonner";

// Access the Electron API
declare global {
  interface Window {
    electron: ElectronAPI;
    api: {
      ipcRenderer: {
        invoke(channel: string, ...args: any[]): Promise<any>;
        on(channel: string, func: (...args: any[]) => void): void;
        once(channel: string, func: (...args: any[]) => void): void;
        removeListener(channel: string, func: (...args: any[]) => void): void;
        removeAllListeners(channel: string): void;
      };
    };
  }
}

const { Header, Content, Sider } = Layout;
const { Title } = Typography;

function AppContent(): JSX.Element {
  const navigate = useNavigate();
  const location = useLocation();
  const [collapsed, setCollapsed] = useState(false);
  const [pageKey, setPageKey] = useState<string>("home");

  const onCollapse = (collapsed) => {
    setCollapsed(collapsed);
  };

  useEffect(() => {
    const newKey = `${location.pathname}-${Date.now()}`;
    setPageKey(newKey);
  }, [location.pathname]);

  const renderContent = () => {
    switch (location.pathname) {
      case "/config":
        return <div>Config Page</div>;
      case "/input-ports":
        return <div>Input Ports Page</div>;
      case "/output-ports":
        return <div>Output Ports Page</div>;
      case "/console":
        return <div>Console Page</div>;
      case "/help":
        return <div>Help Page</div>;
      case "/license":
        return <div>License Management Page</div>;
      default:
        return (
          <div className="w-full min-h-full p-2 sm:p-3 md:p-4 lg:p-6 flex justify-center overflow-visible">
            <div className="mt-2 bg-black border-2 border-cyan-500/30 shadow-[0_0_15px_rgba(0,188,212,0.3)] w-full overflow-visible">
              <Title
                level={4}
                className="text-white m-0 font-mono text-base p-4"
              >
                Dashboard
              </Title>
              <div className="p-4">{/* Add your dashboard content here */}</div>
            </div>
          </div>
        );
    }
  };

  const menuItems = [
    {
      key: "/",
      icon: <HomeOutlined />,
      label: "Home",
    },
    {
      key: "/input-ports",
      icon: <ArrowRightOutlined />,
      label: "Input Ports",
    },
    {
      key: "/output-ports",
      icon: <ArrowLeftOutlined />,
      label: "Output Ports",
    },
    {
      key: "/console",
      icon: <ConsoleSqlOutlined />,
      label: "Console",
    },
    {
      key: "/config",
      icon: <SettingOutlined />,
      label: "Configurations",
    },
    {
      key: "/license",
      icon: <KeyOutlined />,
      label: "License Management",
    },
    {
      key: "/help",
      icon: <QuestionCircleOutlined />,
      label: "Help & Support",
    },
  ];

  return (
    <ConfigProvider
      theme={{
        algorithm: theme.darkAlgorithm,
        token: {
          colorPrimary: "#00bcd4",
          colorText: "#ffffff",
          colorBgBase: "#000000",
        },
      }}
    >
      <Layout className="min-h-screen bg-black">
        <Toaster
          position="bottom-right"
          theme="dark"
          toastOptions={{
            style: {
              background: "#000000",
              color: "#ffffff",
              border: "1px solid rgba(0, 188, 212, 0.3)",
              boxShadow: "0 0 15px rgba(0, 188, 212, 0.3)",
              fontFamily: "monospace",
              fontSize: "12px",
              borderRadius: "4px",
            },
            duration: 4000,
          }}
        />

        <Sider
          collapsible
          theme="dark"
          collapsed={collapsed}
          onCollapse={onCollapse}
          width={"25%"}
          className="bg-black border-r border-white/30 shadow-[0_0_8px_rgba(255,255,255,0.3)] [&_.ant-layout-sider-trigger]:bg-cyan-500 [&_.ant-layout-sider-trigger]:text-black [&_.ant-layout-sider-trigger]:border-t [&_.ant-layout-sider-trigger]:border-white/30"
        >
          <div className="logo" />
          <Menu
            theme="dark"
            mode="inline"
            selectedKeys={[location.pathname]}
            items={menuItems}
            onClick={({ key }) => navigate(key)}
            className="
            bg-black 
            [&_.ant-menu-item]:text-white 
            [&_.ant-menu-item_.anticon]:text-white 
            [&_.ant-menu-item:hover]:text-cyan-500 
            [&_.ant-menu-item:hover_.anticon]:text-cyan-500 
            [&_.ant-menu-item-selected]:!text-cyan-500 
            [&_.ant-menu-item-selected_.anticon]:!text-cyan-500 
            [&_.ant-menu-item-selected]:!bg-white/20 
            [&_.ant-menu-item-selected:hover]:!text-cyan-500 
            [&_.ant-menu-item-selected:hover]:!bg-cyan-500"
          />
        </Sider>

        <Layout
          className="site-layout bg-black"
          style={{
            height: "100vh",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <Header
            className="site-layout-background border-b border-white/30 shadow-[0_0_8px_rgba(255,255,255,0.3)]"
            style={{
              padding: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              height: "64px",
              position: "relative",
            }}
          >
            <div className="absolute inset-0 bg-black/50"></div>
            <Title level={3} className="text-white m-0 relative z-10">
              Your App Name
            </Title>
          </Header>

          <Content className="flex-1 overflow-auto m-6 pb-20">
            {renderContent()}
          </Content>
        </Layout>
      </Layout>
    </ConfigProvider>
  );
}

export default function App(): JSX.Element {
  return (
    <Router>
      <AppContent />
    </Router>
  );
}
