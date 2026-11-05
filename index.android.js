import {AppRegistry} from 'react-native';
import App from './src/App';
import {registerProvider} from './src/ts/modules/base/utils/AppProviderUtil';
import {waitForGenerationIdle} from './src/ts/modules/NovelReader/local/engine';

registerProvider();
AppRegistry.registerComponent('App', () => App);
AppRegistry.registerHeadlessTask('VoiceWeaverGeneration', () => waitForGenerationIdle);
