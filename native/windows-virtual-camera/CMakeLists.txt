cmake_minimum_required(VERSION 3.24)
project(WhisperVirtualCameraBridge LANGUAGES CXX)

add_executable(WhisperVirtualCameraBridge bridge/main.cpp)
target_compile_features(WhisperVirtualCameraBridge PRIVATE cxx_std_20)
target_compile_definitions(WhisperVirtualCameraBridge PRIVATE UNICODE _UNICODE WIN32_LEAN_AND_MEAN NOMINMAX)
target_link_libraries(WhisperVirtualCameraBridge PRIVATE advapi32)

if(MSVC)
  target_compile_options(WhisperVirtualCameraBridge PRIVATE /W4 /permissive-)
endif()
