import {HostComponent, ViewProps} from 'react-native';
import type {DirectEventHandler} from 'react-native/Libraries/Types/CodegenTypes';
import codegenNativeComponent from 'react-native/Libraries/Utilities/codegenNativeComponent';

export interface RnFabricViewProps extends ViewProps {
  src: string;
  onReceiveData?: DirectEventHandler<OnReceiveEventData>;
}

export default codegenNativeComponent<RnFabricViewProps>(
  'RnFabricView',
) as HostComponent<RnFabricViewProps>;

export type OnReceiveEventData = Readonly<{
  rnValue: string;
}>;
