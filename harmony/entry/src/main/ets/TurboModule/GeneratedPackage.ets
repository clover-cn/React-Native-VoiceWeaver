import type { TurboModule, TurboModuleContext } from '@rnoh/react-native-openharmony/ts';
import { RNPackage, TurboModulesFactory } from '@rnoh/react-native-openharmony/ts';
import { TM } from '@rnoh/react-native-openharmony/generated/ts';
import { RnBridge } from './RnBridge';

class GeneratedTurboModulesFactory extends TurboModulesFactory {
  createTurboModule(name: string): TurboModule | null {
    if (name === TM.BridgeTurboModule.NAME) {
      return new RnBridge(this.ctx);
    }
    return null;
  }

  hasTurboModule(name: string): boolean {
    return name === TM.BridgeTurboModule.NAME;
  }
}

export class GeneratedPackage extends RNPackage {
  createTurboModulesFactory(ctx: TurboModuleContext): TurboModulesFactory {
    return new GeneratedTurboModulesFactory(ctx);
  }
}