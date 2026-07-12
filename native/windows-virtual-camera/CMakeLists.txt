cmake_minimum_required(VERSION 3.24)
project(WhisperVirtualCamera LANGUAGES CXX)

add_executable(WhisperVirtualCameraBridge bridge/main.cpp)
target_compile_features(WhisperVirtualCameraBridge PRIVATE cxx_std_20)
target_compile_definitions(WhisperVirtualCameraBridge PRIVATE UNICODE _UNICODE WIN32_LEAN_AND_MEAN NOMINMAX)
target_link_libraries(WhisperVirtualCameraBridge PRIVATE advapi32)

add_executable(WhisperVirtualCameraManager manager/main.cpp)
target_compile_features(WhisperVirtualCameraManager PRIVATE cxx_std_20)
target_compile_definitions(WhisperVirtualCameraManager PRIVATE UNICODE _UNICODE WIN32_LEAN_AND_MEAN NOMINMAX)
target_link_libraries(WhisperVirtualCameraManager PRIVATE mfplat mfuuid mfsensorgroup ole32)

add_library(WhisperVirtualCameraFrameReader STATIC source/frame_reader.cpp)
target_compile_features(WhisperVirtualCameraFrameReader PRIVATE cxx_std_20)
target_compile_definitions(WhisperVirtualCameraFrameReader PRIVATE UNICODE _UNICODE WIN32_LEAN_AND_MEAN NOMINMAX)
target_include_directories(WhisperVirtualCameraFrameReader PUBLIC source include)

if(MSVC)
  target_compile_options(WhisperVirtualCameraBridge PRIVATE /W4 /permissive-)
  target_compile_options(WhisperVirtualCameraManager PRIVATE /W4 /permissive-)
  target_compile_options(WhisperVirtualCameraFrameReader PRIVATE /W4 /permissive-)
  target_link_options(WhisperVirtualCameraManager PRIVATE "/MANIFESTUAC:level='requireAdministrator' uiAccess='false'")
endif()
