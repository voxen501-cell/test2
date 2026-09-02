cmake_minimum_required(VERSION 3.22.1)
project(bedrockai)

# libnode.so comes prebuilt from nodejs-mobile; this wrapper only starts it.
add_library(node SHARED IMPORTED)
set_target_properties(node PROPERTIES
    IMPORTED_LOCATION ${CMAKE_SOURCE_DIR}/../jniLibs/${ANDROID_ABI}/libnode.so)

add_library(bedrockai SHARED node_bridge.cpp)

target_include_directories(bedrockai PRIVATE ${CMAKE_SOURCE_DIR}/include/node)
target_link_libraries(bedrockai node log)
