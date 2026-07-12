cmake_minimum_required(VERSION 3.24)
project(WhisperVirtualCamera LANGUAGES CXX)

include(CTest)

if(MSVC)
  set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
endif()

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

add_library(WhisperVirtualCameraSource SHARED
  source/activation.cpp
  source/exports.def
  source/virtual_camera_source.cpp)
target_compile_features(WhisperVirtualCameraSource PRIVATE cxx_std_20)
target_compile_definitions(WhisperVirtualCameraSource PRIVATE UNICODE _UNICODE WIN32_LEAN_AND_MEAN NOMINMAX)
target_include_directories(WhisperVirtualCameraSource PRIVATE source include)
target_link_libraries(WhisperVirtualCameraSource PRIVATE
  WhisperVirtualCameraFrameReader
  advapi32
  mfplat
  mfsensorgroup
  mfuuid
  ole32)
set_target_properties(WhisperVirtualCameraSource PROPERTIES
  PREFIX ""
  OUTPUT_NAME "WhisperVirtualCameraSource")

if(BUILD_TESTING)
  add_executable(WhisperVirtualCameraSourceSmokeTest tests/source_smoke_test.cpp)
  target_compile_features(WhisperVirtualCameraSourceSmokeTest PRIVATE cxx_std_20)
  target_compile_definitions(WhisperVirtualCameraSourceSmokeTest PRIVATE UNICODE _UNICODE WIN32_LEAN_AND_MEAN NOMINMAX)
  target_link_libraries(WhisperVirtualCameraSourceSmokeTest PRIVATE mfplat ole32)
  add_test(
    NAME WhisperVirtualCameraSourceSmokeTest
    COMMAND WhisperVirtualCameraSourceSmokeTest $<TARGET_FILE:WhisperVirtualCameraSource>)
endif()

if(MSVC)
  target_compile_options(WhisperVirtualCameraBridge PRIVATE /W4 /permissive-)
  target_compile_options(WhisperVirtualCameraManager PRIVATE /W4 /permissive-)
  target_compile_options(WhisperVirtualCameraFrameReader PRIVATE /W4 /permissive-)
  target_compile_options(WhisperVirtualCameraSource PRIVATE /W4 /permissive-)
  if(BUILD_TESTING)
    target_compile_options(WhisperVirtualCameraSourceSmokeTest PRIVATE /W4 /permissive-)
  endif()
  target_link_options(WhisperVirtualCameraManager PRIVATE "/MANIFESTUAC:level='requireAdministrator' uiAccess='false'")
endif()
