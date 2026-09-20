import {AppRegistry} from 'react-native';
import App from './src/App';
import {registerProvider} from './src/ts/modules/base/utils/AppProviderUtil';

registerProvider();
AppRegistry.registerComponent('App', () => App);
