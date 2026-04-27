import {AppRegistry} from 'react-native';
import SimpleWebPage from './pages/web/SimpleWebPage';
import {registerProvider} from './utils/AppProviderUtil';
import NovelReaderApp from '../NovelReader/NovelReaderApp';

// 注册基础 Provider
registerProvider();

// 注册通用 Web 页面
AppRegistry.registerComponent('Web', () => SimpleWebPage);

// 注册全新小说阅读与听书应用
AppRegistry.registerComponent('NovelReaderApp', () => NovelReaderApp);
