set(RNOH_C_API_ARCH 1)
add_compile_definitions(RNOH_C_API_ARCH=1)
project(rnapp)
cmake_minimum_required(VERSION 3.4.1)
set(RNOH_APP_DIR "${CMAKE_CURRENT_SOURCE_DIR}")
set(CMAKE_ASM_FLAGS "-Wno-error=unused-command-line-argument -Qunused-arguments")
set(OH_MODULE_DIR "${CMAKE_CURRENT_SOURCE_DIR}/../../../oh_modules")

set(RNOH_CPP_DIR "${OH_MODULE_DIR}/@rnoh/react-native-openharmony/src/main/cpp")
set(WITH_HITRACE_SYSTRACE 1) # for other CMakeLists.txt files to use
set(OH_MODULES "${CMAKE_CURRENT_SOURCE_DIR}/../../../oh_modules")
add_compile_definitions(WITH_HITRACE_SYSTRACE)

add_subdirectory("${RNOH_CPP_DIR}" ./rn)
file(GLOB GENERATED_CPP_FILES "./generated/*.cpp")
file(REAL_PATH "${RNOH_CPP_DIR}" RNOH_CPP_DIR)

# RNOH_BEGIN: add_package_subdirectories
add_subdirectory("${OH_MODULES}/@react-native-ohos/react-native-linear-gradient/src/main/cpp" ./linear-gradient)
add_subdirectory("${OH_MODULES}/@react-native-ohos/checkbox/src/main/cpp" ./checkbox)
add_subdirectory("${OH_MODULES}/@react-native-oh-tpl/react-native-view-shot/src/main/cpp" ./view-shot)
add_subdirectory("${OH_MODULES}/@react-native-ohos/react-native-video/src/main/cpp" ./video)
# RNOH_END: add_package_subdirectories

add_library(rnoh_app SHARED
    ${GENERATED_CPP_FILES}
    "./PackageProvider.cpp"
    "./RnFabricPackage.cpp"
    "${RNOH_CPP_DIR}/RNOHAppNapiBridge.cpp"
    "./Fabric/RnFabircView/RnFabricViewEventEmitter"
    "./Fabric/RnFabircView/RnFabricProps.cpp"
    ${RNFABRIC_CPP_FILES}
)

# RNOH_BEGIN: link_packages
target_link_libraries(rnoh_app PUBLIC rnoh)
target_link_libraries(rnoh_app PUBLIC rnoh_view_shot)
target_link_libraries(rnoh_app PUBLIC rnoh_linear_gradient)
target_link_libraries(rnoh_app PUBLIC rnoh_checkbox)
target_link_libraries(rnoh_app PUBLIC rnoh_video)
# RNOH_END: link_packages
